// =========================================================================
// ===             UNIWERSALNY SILNIK GALERII GOOGLE DRIVE             ===
// =========================================================================

// ========= KONFIGURACJA DLA TEJ INSTANCJI GALERII =========
// Zmieniaj tylko te 3 wartości w zależności od strony, na której wdrażasz galerię.

// ID tej konkretnej galerii (z pliku galleries.config.json na serwerze)
const GALLERY_ID = 'parafia'

const API_BASE_URL = 'http://localhost:3010'

// Adres URL Twojego serwera API
//const API_BASE_URL = 'https://galeria-api.nautil2.hekko24.pl'

// Ustaw na `true`, aby pokazać daty w tytułach, lub `false`, aby je ukryć
const SHOW_DATES_IN_ALBUM_TITLES = true

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
			if (data.media && data.media.length > 0) {
				data.media.forEach((item, index) => {
					const thumbnailUrl = item.thumbnailUrl || 'https://via.placeholder.com/400x300.png?text=Brak+miniatury'

					if (item.type === 'video') {
						const videoUrl = `${API_BASE_URL}/api/${GALLERY_ID}/video/${item.id}`
						html += `
                            <a href="${videoUrl}" class="video-link" data-video='{"source": [{"src":"${videoUrl}", "type":"video/mp4"}], "attributes": {"preload": false, "controls": true}}'>
                                <img src="${thumbnailUrl}" loading="lazy" alt="${item.filename}">
                                <div class="play-icon"></div>
                            </a>`
					} else {
						// 'image'
						const imageUrl = `${API_BASE_URL}/api/${GALLERY_ID}/image/${item.id}`
						html += `
                            <a href="${imageUrl}" data-pswp-uid="${index + 1}" class="photo-link">
                                <img src="${thumbnailUrl}" loading="lazy" alt="${item.filename}">
                            </a>`
						photoSwipeItems.push({
							src: imageUrl,
							w: parseInt(item.width, 10),
							h: parseInt(item.height, 10),
						})
					}
				})
			} else {
				html = '<p>W tym albumie nie ma żadnych zdjęć ani filmów.</p>'
			}

			galleryContainer.innerHTML = html

			imagesLoaded(galleryContainer, function () {
				const pWrapper = document.createElement('p')
				pWrapper.className = 'back-button-wrapper'
				const newButton = document.createElement('button')
				newButton.className = 'back-button'
				newButton.textContent = 'Powrót'
				newButton.onclick = goBack
				pWrapper.appendChild(newButton)
				galleryContainer.parentNode.insertBefore(pWrapper, galleryContainer)

				msnry = new Masonry(galleryContainer, {
					itemSelector: '.photo-link, .video-link', // Obsługujemy oba typy
					columnWidth: '.photo-link, .video-link',
					gutter: 10,
					percentPosition: true,
				})

				// Zamiast lightGallery, użyj prostego modala dla filmów
				document.querySelectorAll('.video-link').forEach(link => {
					link.addEventListener('click', function (e) {
						e.preventDefault()
						const videoUrl = this.getAttribute('href')

						// Utwórz modal z odtwarzaczem
						const modal = document.createElement('div')
						modal.style.cssText = `
							position: fixed;
							top: 0;
							left: 0;
							width: 100%;
							height: 100%;
							background: rgba(0,0,0,0.9);
							z-index: 9999;
							display: flex;
							align-items: center;
							justify-content: center;
							padding: 20px;
							box-sizing: border-box;
						`

						modal.innerHTML = `
							<div style="position: relative; width: 100%; max-width: 800px;">
								<video controls autoplay style="width: 100%; height: auto; max-height: 80vh;">
									<source src="${videoUrl}" type="video/mp4">
									Twoja przeglądarka nie obsługuje odtwarzania wideo.
								</video>
								<button onclick="this.closest('div').remove()" style="
									position: absolute;
									top: -40px;
									right: 0;
									background: white;
									border: none;
									font-size: 24px;
									width: 30px;
									height: 30px;
									border-radius: 50%;
									cursor: pointer;
								">×</button>
							</div>
						`

						// Zamknij modal po kliknięciu w tło
						modal.addEventListener('click', function (e) {
							if (e.target === modal) {
								modal.remove()
							}
						})

						document.body.appendChild(modal)
					})
				})

				document.getElementById('spinner').style.display = 'none'
				galleryContainer.classList.remove('is-loading')
				isGalleryLoading = false
			})

			// Inicjalizacja PhotoSwipe TYLKO dla zdjęć
			document.querySelectorAll('.photo-link').forEach((link, index) => {
				link.addEventListener('click', function (e) {
					e.preventDefault()
					// Musimy znaleźć prawidłowy index w okrojonej tablicy photoSwipeItems
					const clickedUrl = e.currentTarget.getAttribute('href')
					const photoSwipeIndex = photoSwipeItems.findIndex(item => item.src === clickedUrl)

					let pswpElement = document.querySelectorAll('.pswp')[0]
					let options = { index: photoSwipeIndex }
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
