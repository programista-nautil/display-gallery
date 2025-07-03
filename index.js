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
					const imagesResponse = await drive.files.list({
						q: `'${album.id}' in parents and mimeType contains 'image/' and trashed = false`,
						pageSize: 1,
						fields: 'files(thumbnailLink)',
					})
					const firstImage = imagesResponse.data.files[0]
					const coverUrl = firstImage ? firstImage.thumbnailLink.replace(/=s\d+$/, '=w400') : null
					return { id: album.id, name: album.name, coverUrl }
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

app.get('/api/:galleryId/folder/:folderId', loadGalleryConfig, async (req, res) => {
	const { folderId } = req.params

	try {
		const response = await drive.files.list({
			q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
			fields: 'files(id, name, imageMediaMetadata(width,height))',
			pageSize: 1000,
		})

		const photos = (response.data.files || [])
			.filter(file => file.imageMediaMetadata)
			.map(file => ({
				id: file.id,
				filename: file.name,
				url: `https://lh3.googleusercontent.com/d/${file.id}`,
				width: file.imageMediaMetadata.width || 1200,
				height: file.imageMediaMetadata.height || 800,
			}))
			.reverse()

		res.json({ photos })
	} catch (error) {
		res.status(500).send('Błąd serwera podczas pobierania zdjęć.')
	}
})

// --- URUCHOMIENIE SERWERA ---
const PORT = process.env.PORT || 3010
app.listen(PORT, () => {
	console.log(`Scentralizowany serwer galerii (Service Account) nasłuchuje na porcie ${PORT}`)
})
