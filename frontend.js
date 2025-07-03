// ID tej konkretnej galerii (z pliku galleries.config.json na serwerze)
const GALLERY_ID = 'parafia'

// Adres URL Twojego serwera API. Do testów na localhost:
const API_BASE_URL = 'https://galeria-api.nautil2.hekko24.pl'

const SHOW_DATES_IN_ALBUM_TITLES = false

function goBack() {
	loadAlbums()
}

function loadAlbums() {
	document.getElementById('spinner').style.display = 'block'
	document.querySelector('.gallery').innerHTML = ''

	// ZMIANA: Używamy nowego, uniwersalnego adresu URL
	fetch(`${API_BASE_URL}/api/${GALLERY_ID}/folders`)
		.then(response => {
			document.getElementById('spinner').style.display = 'none'
			if (!response.ok) {
				throw response
			}
			return response.json()
		})
		.then(data => {
			console.log(data)
			let html = ''
			if (data && data.length > 0) {
				data.forEach(folder => {
					const displayName = SHOW_DATES_IN_ALBUM_TITLES
						? folder.name // Jeśli flaga to true, użyj pełnej nazwy
						: folder.name.replace(/^\d{4}-\d{2}-\d{2}\s/, '') // Jeśli false, usuń datę
					const coverUrl = folder.coverUrl || 'https://via.placeholder.com/400x300.png?text=Pusty+Album'
					html += `
                        <div class="album" onclick="loadPhotos('${folder.id}')">
                            <img class="cover" src="${coverUrl}" alt="${displayName}" loading="lazy">
                            <div class="title">${displayName}</div>
                        </div>`
				})
			} else {
				html = '<p>Nie znaleziono żadnych albumów w folderze "Galeria Zdjęć".</p>'
			}
			document.querySelector('.gallery').innerHTML = html
		})
		.catch(error => {
			document.getElementById('spinner').style.display = 'none'
			console.error('Błąd:', error)
			document.querySelector('.gallery').innerHTML =
				'<p>Wystąpił błąd podczas ładowania albumów. Sprawdź konsolę (F12) w poszukiwaniu błędów CORS lub "mixed content".</p>'
		})
}

function loadPhotos(albumId) {
	// ZMIANA: Używamy nowego, uniwersalnego adresu URL
	fetch(`${API_BASE_URL}/api/${GALLERY_ID}/folder/${albumId}`)
		.then(response => response.json())
		.then(data => {
			console.log(data)
			let html = ''
			let photoSwipeItems = []
			if (data.photos && data.photos.length > 0) {
				data.photos.forEach((photo, index) => {
					html += `<a href="${photo.url}" data-pswp-uid="${index + 1}" class="photo-link"><img src="${
						photo.url
					}" loading="lazy" alt="${photo.filename}"></a>`

					photoSwipeItems.push({
						src: `${photo.url}=d`,

						w: parseInt(photo.width, 10),

						h: parseInt(photo.height, 10),
					})
				})
				document.querySelector('.gallery').dataset.photoswipeItems = JSON.stringify(photoSwipeItems)
			} else {
				html = '<p>No media items found.</p>'
			}

			document.querySelector('.gallery').innerHTML = html

			document.querySelectorAll('.photo-link').forEach((link, index) => {
				link.addEventListener('click', function (e) {
					e.preventDefault()
					let pswpElement = document.querySelectorAll('.pswp')[0]
					let options = { index: index }
					let gallery = new PhotoSwipe(pswpElement, PhotoSwipeUI_Default, photoSwipeItems, options)
					gallery.init()
				})
			})
		})
		.catch(error => console.error('Błąd:', error))
}

document.addEventListener('DOMContentLoaded', function () {
	loadAlbums()
})
