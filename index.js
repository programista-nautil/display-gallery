const express = require('express')
const { google } = require('googleapis')
const fs = require('fs')
const cors = require('cors')
require('dotenv').config()

// --- KONFIGURACJA APLIKACJI ---
const app = express()
const GALLERIES_CONFIG_PATH = './galleries.config.json'
const MASTER_FOLDER_ID = process.env.MASTER_GALLERY_FOLDER_ID

const log = (level, message, data = '') => {
	const timestamp = new Date().toLocaleString('pl-PL')
	const logFunc = console[level.toLowerCase()] || console.log
	logFunc(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data)
}

// Wczytujemy konfigurację galerii
let galleriesConfig
try {
	galleriesConfig = JSON.parse(fs.readFileSync(GALLERIES_CONFIG_PATH, 'utf8'))
	console.log('Konfiguracja galerii została pomyślnie wczytana.')
} catch (error) {
	console.error(`KRYTYCZNY BŁĄD: Nie można wczytać pliku konfiguracyjnego ${GALLERIES_CONFIG_PATH}.`, error)
	process.exit(1)
}

// --- AUTORYZACJA PRZEZ SERVICE ACCOUNT ---
const auth = new google.auth.GoogleAuth({
	scopes: ['https://www.googleapis.com/auth/drive.readonly'],
	// Ścieżka do klucza jest automatycznie wczytywana ze zmiennej środowiskowej GOOGLE_APPLICATION_CREDENTIALS
})

const drive = google.drive({ version: 'v3', auth })

// --- MIDDLEWARE I CORS ---
const loadGalleryConfig = (req, res, next) => {
	const galleryId = req.params.galleryId
	const config = galleriesConfig[galleryId]

	if (!config) {
		return res.status(404).send('Galeria o podanym ID nie została znaleziona.')
	}
	req.galleryConfig = config
	next()
}

app.use(
	cors({
		origin: function (origin, callback) {
			const isAllowed = Object.values(galleriesConfig).some(config => config.allowedOrigin === origin)
			if (isAllowed || !origin) {
				callback(null, true)
			} else {
				callback(new Error(`Niedozwolony origin: ${origin}`))
			}
		},
	})
)

// --- ENDPOINTY API ---

app.get('/', (req, res) => {
	res.status(200).send('<h1>Serwer Galerii działa poprawnie!</h1><p>API jest gotowe do użycia.</p>')
})

app.get('/api/:galleryId/folders', loadGalleryConfig, async (req, res) => {
	const { clientFolderName } = req.galleryConfig

	try {
		// KROK 1: Znajdź folder klienta po nazwie wewnątrz głównego folderu galerii
		const clientFolderResponse = await drive.files.list({
			q: `name = '${clientFolderName}' and '${MASTER_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
			fields: 'files(id)',
			pageSize: 1,
		})

		const clientFolder = clientFolderResponse.data.files[0]
		if (!clientFolder) {
			console.warn(`Nie znaleziono folderu klienta o nazwie: ${clientFolderName}`)
			return res.json([]) // Zwróć pustą tablicę, jeśli folder klienta nie istnieje
		}
		const clientFolderId = clientFolder.id

		// KROK 2: Pobierz foldery-albumy z folderu klienta (logika jak wcześniej)
		const albumsResponse = await drive.files.list({
			q: `mimeType='application/vnd.google-apps.folder' and '${clientFolderId}' in parents and trashed = false`,
			fields: 'files(id, name)',
		})
		const albums = albumsResponse.data.files || []

		const albumsWithCovers = await Promise.all(
			albums.map(async album => {
				try {
					// Krok 1: Pobieramy WSZYSTKIE zdjęcia z albumu i ich NAZWY
					const imagesResponse = await drive.files.list({
						q: `'${album.id}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
						// Usuwamy pageSize: 1, prosimy o nazwę i miniaturę
						fields: 'files(name, thumbnailLink)',
					})

					let finalCoverUrl = null

					if (imagesResponse.data.files && imagesResponse.data.files.length > 0) {
						const allPhotos = imagesResponse.data.files

						// Krok 2: Szukamy zdjęcia z "_cover" w nazwie
						const coverPhoto = allPhotos.find(photo => photo.name && photo.name.includes('_cover'))

						if (coverPhoto) {
							// Jeśli jest, używamy jego miniatury
							finalCoverUrl = coverPhoto.thumbnailLink
						} else {
							// Jeśli nie ma, bierzemy pierwsze z listy
							finalCoverUrl = allPhotos[0].thumbnailLink
						}
					}

					// Zmieniamy rozmiar miniatury dla lepszej jakości
					const sizedCoverUrl = finalCoverUrl ? finalCoverUrl.replace(/=s\d+$/, '=w400') : null

					return { id: album.id, name: album.name, coverUrl: sizedCoverUrl }
				} catch (e) {
					console.error(`Błąd pobierania okładki dla albumu ${album.name}:`, e.message)
					return { id: album.id, name: album.name, coverUrl: null }
				}
			})
		)

		albumsWithCovers.sort((a, b) => b.name.localeCompare(a.name))
		res.json(albumsWithCovers)
	} catch (error) {
		console.error('Błąd pobierania folderów:', error.response ? error.response.data : error.message)
		res.status(500).send('Błąd serwera podczas pobierania folderów.')
	}
})

/**
 * Wyciąga numer w nawiasie z nazwy pliku.
 * @param {string} filename - Nazwa pliku, np. "Zdjęcie (12).jpg"
 * @returns {number|null} - Zwraca liczbę lub null, jeśli nie znaleziono.
 */
function extractNumberFromFilename(filename) {
	const match = filename.match(/\((\d+)\)/)
	if (match && match[1]) {
		return parseInt(match[1], 10)
	}
	return null
}

app.get('/api/:galleryId/folder/:folderId', loadGalleryConfig, async (req, res) => {
	const { folderId } = req.params
	const { name: galleryName } = req.galleryConfig
	log('info', `[${galleryName}] Rozpoczęto pobieranie mediów dla albumu o ID: ${folderId}`)

	try {
		const response = await drive.files.list({
			q: `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
			fields: 'files(id, name, mimeType, thumbnailLink, videoMediaMetadata, imageMediaMetadata(width,height))',
			pageSize: 1000,
		})

		const media = (response.data.files || [])
			.filter(file => file.imageMediaMetadata || file.videoMediaMetadata)
			.map(file => {
				const isVideo = file.mimeType.startsWith('video')
				return {
					id: file.id,
					filename: file.name,
					type: isVideo ? 'video' : 'image',
					// Dla filmów i zdjęć używamy linku do miniatury w siatce
					thumbnailUrl: file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, '=w400') : null,
					// Pełny URL będzie budowany na froncie przez proxy
					width: file.imageMediaMetadata?.width || parseInt(file.videoMediaMetadata?.width, 10) || 1280,
					height: file.imageMediaMetadata?.height || parseInt(file.videoMediaMetadata?.height, 10) || 720,
				}
			})

		media.sort((a, b) => {
			const numA = extractNumberFromFilename(a.filename)
			const numB = extractNumberFromFilename(b.filename)

			// Scenariusz 1: Oba pliki mają numer w nazwie
			if (numA !== null && numB !== null) {
				return numA - numB // Sortuj numerycznie rosnąco
			}
			// Scenariusz 2: Tylko plik 'a' ma numer -> idzie na początek
			if (numA !== null) {
				return -1
			}
			// Scenariusz 3: Tylko plik 'b' ma numer -> idzie na początek
			if (numB !== null) {
				return 1
			}
			// Scenariusz 4: Żaden plik nie ma numeru -> sortuj alfabetycznie
			return a.filename.localeCompare(b.filename)
		})

		log('info', `[${galleryName}] Pomyślnie pobrano i przetworzono ${media.length} mediów. Wysyłam odpowiedź.`)
		res.json({ media }) // Zmieniamy nazwę na "media" dla jasności
	} catch (error) {
		log('error', `[${galleryName}] Wystąpił błąd w endpoincie /folder/${folderId}:`, error.message)
		res.status(500).send('Błąd serwera podczas pobierania mediów.')
	}
})

app.get('/api/:galleryId/image/:fileId', loadGalleryConfig, async (req, res) => {
	const { fileId } = req.params
	try {
		const fileStream = await drive.files.get({ fileId: fileId, alt: 'media' }, { responseType: 'stream' })
		res.setHeader('Content-Type', 'image/jpeg')
		fileStream.data.pipe(res)
	} catch (error) {
		log('error', `Błąd podczas proxy dla obrazka o ID ${fileId}:`, error.message)
		res.status(404).send('Nie znaleziono obrazka.')
	}
})

app.get('/api/:galleryId/video/:fileId', loadGalleryConfig, async (req, res) => {
	const { fileId } = req.params
	const { name: galleryName } = req.galleryConfig
	log('info', `[${galleryName}] Żądanie streamowania wideo o ID: ${fileId}`)

	try {
		// Pobierz metadane pliku dla uzyskania typu MIME
		const fileMetadata = await drive.files.get({
			fileId: fileId,
			fields: 'mimeType, size',
		})

		const mimeType = fileMetadata.data.mimeType || 'video/mp4'
		const fileSize = parseInt(fileMetadata.data.size, 10)

		// Obsługa range requests dla seeking w filmie
		const range = req.headers.range
		if (range && fileSize) {
			const parts = range.replace(/bytes=/, '').split('-')
			const start = parseInt(parts[0], 10)
			const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
			const chunksize = end - start + 1

			res.status(206)
			res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
			res.setHeader('Accept-Ranges', 'bytes')
			res.setHeader('Content-Length', chunksize)
			res.setHeader('Content-Type', mimeType)

			// Stream z zakresu
			const fileStream = await drive.files.get(
				{
					fileId: fileId,
					alt: 'media',
				},
				{
					responseType: 'stream',
					headers: {
						Range: `bytes=${start}-${end}`,
					},
				}
			)

			fileStream.data.pipe(res)
		} else {
			// Zwykły stream bez range
			res.setHeader('Content-Type', mimeType)
			if (fileSize) {
				res.setHeader('Content-Length', fileSize)
			}

			const fileStream = await drive.files.get(
				{
					fileId: fileId,
					alt: 'media',
				},
				{ responseType: 'stream' }
			)

			fileStream.data.pipe(res)
		}

		log('info', `[${galleryName}] Rozpoczęto streaming wideo: ${fileId}`)
	} catch (error) {
		log('error', `Błąd podczas streamowania wideo o ID ${fileId}:`, error.message)
		res.status(500).send('Błąd serwera.')
	}
})

// --- URUCHOMIENIE SERWERA ---
const PORT = process.env.PORT || 3010
app.listen(PORT, () => {
	console.log(`Scentralizowany serwer galerii (Service Account) nasłuchuje na porcie ${PORT}`)
})
