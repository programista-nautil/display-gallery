// =========================================================================
// ===             UNIWERSALNY SILNIK GALERII GOOGLE DRIVE             ===
// =========================================================================

// ========= KONFIGURACJA DLA TEJ INSTANCJI GALERII =========
// Zmieniaj tylko te 3 wartości w zależności od strony, na której wdrażasz galerię.

// ID tej konkretnej galerii (z pliku galleries.config.json na serwerze)
const GALLERY_ID = 'parafia'

// Adres URL Twojego serwera API
const API_BASE_URL = 'https://galeria-api.nautil2.hekko24.pl'

// Ustaw na `true`, aby pokazać daty w tytułach, lub `false`, aby je ukryć
const SHOW_DATES_IN_ALBUM_TITLES = false

// default lub large-tiles
const GALLERY_LAYOUT_STYLE = 'large-tiles'
// ==========================================================

// --- Zmienne stanu aplikacji (nie ruszaj) ---
let msnry = null
let isGalleryLoading = false

/**
 * Funkcja nawigacyjna do powrotu do widoku albumów.
 */
function goBack() {
	loadAlbums()
}

/**
 * Ładuje i wyświetla listę albumów z serwera.
 */
function loadAlbums() {
	if (isGalleryLoading) return
	isGalleryLoading = true

	const galleryContainer = document.querySelector('.gallery')
	galleryContainer.className = 'gallery' // Reset do bazowej klasy
	galleryContainer.classList.add(GALLERY_LAYOUT_STYLE)
	galleryContainer.classList.add('is-loading') // Ukryj galerię przed operacją

	// Usuń przycisk "Powrót", jeśli istnieje
	const buttonWrapper = document.querySelector('.back-button-wrapper')
	if (buttonWrapper) {
		buttonWrapper.remove()
	}

	document.getElementById('spinner').style.display = 'block'

	// Zniszcz instancję Masonry, jeśli istnieje z poprzedniego widoku
	if (msnry) {
		msnry.destroy()
		msnry = null
	}

	fetch(`${API_BASE_URL}/api/${GALLERY_ID}/folders`)
		.then(response => {
			if (!response.ok) throw response
			return response.json()
		})
		.then(data => {
			let html = ''
			if (data && data.length > 0) {
				data.forEach(folder => {
					const displayName = SHOW_DATES_IN_ALBUM_TITLES ? folder.name : folder.name.replace(/^\d{4}-\d{2}-\d{2}\s/, '')
					const coverUrl = folder.coverUrl || 'https://via.placeholder.com/400x300.png?text=Brak+zdjęcia'
					html += `
                        <div class="album" onclick="loadPhotos('${folder.id}')">
                            <img class="cover" src="${coverUrl}" alt="${displayName}" loading="lazy">
                            <div class="title">${displayName}</div>
                        </div>`
				})
			} else {
				html = '<p>Nie znaleziono żadnych albumów.</p>'
			}

			galleryContainer.innerHTML = html
			galleryContainer.classList.add('gallery-albums')
			galleryContainer.classList.remove('gallery-photos')
		})
		.catch(error => {
			console.error('Błąd podczas ładowania albumów:', error)
			galleryContainer.innerHTML = '<p>Wystąpił błąd podczas ładowania albumów.</p>'
		})
		.finally(() => {
			// Ten blok wykona się zawsze - po sukcesie lub po błędzie
			document.getElementById('spinner').style.display = 'none'
			galleryContainer.classList.remove('is-loading')
			isGalleryLoading = false
		})
}

/**
 * Ładuje i wyświetla zdjęcia z wybranego albumu.
 * @param {string} albumId - ID folderu-albumu do wczytania.
 */
function loadPhotos(albumId) {
	if (isGalleryLoading) return
	isGalleryLoading = true

	const galleryContainer = document.querySelector('.gallery')
	galleryContainer.className = 'gallery' // Reset do bazowej klasy
	galleryContainer.classList.add(GALLERY_LAYOUT_STYLE)
	galleryContainer.classList.add('is-loading')
	document.getElementById('spinner').style.display = 'block'

	if (msnry) {
		msnry.destroy()
		msnry = null
	}

	fetch(`${API_BASE_URL}/api/${GALLERY_ID}/folder/${albumId}`)
		.then(response => response.json())
		.then(data => {
			let html = ''
			let photoSwipeItems = []
			if (data.photos && data.photos.length > 0) {
				data.photos.forEach((photo, index) => {
					html += `<a href="${photo.url}" data-pswp-uid="${index + 1}" class="photo-link">
                                <img src="${photo.url}" loading="lazy" alt="${photo.filename}">
                            </a>`
					photoSwipeItems.push({
						src: `${photo.url}=d`,
						w: parseInt(photo.width, 10),
						h: parseInt(photo.height, 10),
					})
				})
			} else {
				html = '<p>W tym albumie nie ma żadnych zdjęć.</p>'
			}

			galleryContainer.innerHTML = html
			galleryContainer.classList.add('gallery-photos')
			galleryContainer.classList.remove('gallery-albums')

			// Używamy imagesLoaded, aby mieć pewność, że Masonry zadziała na w pełni wczytanych obrazkach
			imagesLoaded(galleryContainer, function () {
				// Tworzymy i wstawiamy przycisk "Powrót"
				const pWrapper = document.createElement('p')
				pWrapper.className = 'back-button-wrapper'
				const newButton = document.createElement('button')
				newButton.className = 'back-button'
				newButton.textContent = 'Powrót'
				newButton.onclick = goBack
				pWrapper.appendChild(newButton)
				galleryContainer.parentNode.insertBefore(pWrapper, galleryContainer)

				// Inicjujemy Masonry
				msnry = new Masonry(galleryContainer, {
					itemSelector: '.photo-link',
					columnWidth: '.photo-link',
					gutter: 10,
					percentPosition: true,
				})

				// Finalizujemy ładowanie
				document.getElementById('spinner').style.display = 'none'
				galleryContainer.classList.remove('is-loading')
				isGalleryLoading = false
			})

			// Inicjalizacja PhotoSwipe dla każdego linku
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
		.catch(error => {
			console.error('Błąd podczas ładowania zdjęć:', error)
			galleryContainer.innerHTML = '<p>Wystąpił błąd podczas ładowania zdjęć.</p>'
			document.getElementById('spinner').style.display = 'none'
			galleryContainer.classList.remove('is-loading')
			isGalleryLoading = false
		})
}

// Główny punkt startowy aplikacji po załadowaniu strony
document.addEventListener('DOMContentLoaded', function () {
	loadAlbums()
})
