    const imageLightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxClose = imageLightbox.querySelector('.lightbox-close');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxCounter = document.getElementById('lightboxCounter');
    let lightboxTrigger = null;
    let lightboxPreviousOverflow = '';
    let galleryImages = [];
    let galleryIndex = 0;

    function updateLightboxNav() {
      if (!lightboxPrev || !lightboxNext || !lightboxCounter) return;
      if (galleryImages.length > 1) {
        lightboxPrev.style.display = 'flex';
        lightboxNext.style.display = 'flex';
        lightboxCounter.style.display = 'block';
        lightboxCounter.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
      } else {
        lightboxPrev.style.display = 'none';
        lightboxNext.style.display = 'none';
        lightboxCounter.style.display = 'none';
      }
    }

    function showLightboxIndex(idx) {
      if (galleryImages.length === 0) return;
      if (idx < 0) idx = galleryImages.length - 1;
      if (idx >= galleryImages.length) idx = 0;
      resetPhotoZoom();
      galleryIndex = idx;
      const targetImg = galleryImages[galleryIndex];
      if (targetImg) {
        lightboxImg.src = targetImg.currentSrc || targetImg.src;
        lightboxImg.alt = targetImg.alt || '';
      }
      updateLightboxNav();
    }

    function openPostImage(image) {
      if (!image || image.hidden) return;
      lightboxTrigger = image;
      lightboxPreviousOverflow = document.body.style.overflow;

      const postMedia = image.closest('.post-image');
      if (postMedia) {
        galleryImages = Array.from(postMedia.querySelectorAll('img:not([hidden])'));
        galleryIndex = Math.max(0, galleryImages.indexOf(image));
      } else {
        galleryImages = [image];
        galleryIndex = 0;
      }

      showLightboxIndex(galleryIndex);
      document.body.style.overflow = 'hidden';
      imageLightbox.classList.remove('hidden');
      renderViewerDetails();
      lightboxClose.focus();
    }

    function closePostImage() {
      imageLightbox.classList.add('hidden');
      resetPhotoZoom();
      document.getElementById('lightboxDetails').replaceChildren();
      lightboxImg.removeAttribute('src');
      galleryImages = [];
      galleryIndex = 0;
      updateLightboxNav();
      document.body.style.overflow = lightboxPreviousOverflow;
      if (lightboxTrigger?.isConnected) lightboxTrigger.focus();
      lightboxTrigger = null;
    }

    document.getElementById('realFiles').addEventListener('click', (event) => {
      const moreOverlay = event.target.closest('.post-media-more-overlay');
      if (moreOverlay) {
        const postMedia = moreOverlay.closest('.post-image');
        const imgs = postMedia ? Array.from(postMedia.querySelectorAll('img:not([hidden])')) : [];
        if (imgs.length >= 4) openPostImage(imgs[3]);
        return;
      }
      if (event.target.matches('.post-image img')) {
        const image = event.target;
        if (!image.closest('.post-single-image')) return openPostImage(image);
        if (photoTapTimer && pendingPhoto === image) {
          clearTimeout(photoTapTimer); photoTapTimer = null; pendingPhoto = null;
          likePhoto(image);
        } else {
          clearTimeout(photoTapTimer);
          pendingPhoto = image;
          photoTapTimer = setTimeout(() => { photoTapTimer = null; pendingPhoto = null; if (image.isConnected) openPostImage(image); }, 280);
        }
      }
    });
    document.getElementById('realFiles').addEventListener('keydown', (event) => {
      if (event.target.matches('.post-image img, .post-media-more-overlay') && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (event.target.matches('.post-media-more-overlay')) {
          const postMedia = event.target.closest('.post-image');
          const imgs = postMedia ? Array.from(postMedia.querySelectorAll('img:not([hidden])')) : [];
          if (imgs.length >= 4) openPostImage(imgs[3]);
        } else {
          openPostImage(event.target);
        }
      }
    });

    if (lightboxPrev) {
      lightboxPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        showLightboxIndex(galleryIndex - 1);
      });
    }
    if (lightboxNext) {
      lightboxNext.addEventListener('click', (e) => {
        e.stopPropagation();
        showLightboxIndex(galleryIndex + 1);
      });
    }

    lightboxClose.addEventListener('click', closePostImage);
    imageLightbox.addEventListener('click', (event) => {
      if (event.target === imageLightbox) closePostImage();
    });
    document.addEventListener('keydown', (event) => {
      if (imageLightbox.classList.contains('hidden')) return;
      if (event.key === 'Escape') closePostImage();
      if (event.key === 'ArrowLeft' && galleryImages.length > 1) showLightboxIndex(galleryIndex - 1);
      if (event.key === 'ArrowRight' && galleryImages.length > 1) showLightboxIndex(galleryIndex + 1);
      if (event.key === 'Tab') {
        const controls = Array.from(imageLightbox.querySelectorAll('button:not([disabled]), a[href]')).filter(el => el.offsetParent !== null);
        const first = controls[0], last = controls[controls.length - 1];
        if (!imageLightbox.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });

    let photoTapTimer = null, pendingPhoto = null;
    function likePhoto(image) {
      const card = image.closest('[data-post-id]');
      const button = card?.querySelector('.like-btn');
      if (button && button.dataset.liked !== 'true') void toggleStatusLike(Number(card.dataset.postId), button);
      animatePhotoHeart(image.parentElement);
    }

    function animatePhotoHeart(container) {
      const heart = document.createElement('span');
      heart.className = 'feed-heart'; heart.textContent = '♥'; heart.setAttribute('aria-hidden', 'true');
      container.querySelector('.feed-heart')?.remove();
      container.append(heart);
      setTimeout(() => heart.remove(), 900);
    }

    function animateLikeButton(button) {
      button.classList.remove('like-pop');
      // Restart the animation even when the user likes again after an unlike.
      void button.offsetWidth;
      button.classList.add('like-pop');
    }

    function renderViewerDetails() {
      const details = document.getElementById('lightboxDetails');
      const card = lightboxTrigger?.closest('[data-post-id]');
      const post = card && feedItems.find(item => item._feedType === 'post' && Number(item.id) === Number(card.dataset.postId));
      details.replaceChildren();
      if (!post) return;
      const author = document.createElement('strong'); author.textContent = post.name;
      const time = document.createElement('time'); time.dateTime = post.created_at; time.textContent = new Date(post.created_at).toLocaleString();
      const caption = document.createElement('p'); caption.textContent = post.content || '';
      const actions = document.createElement('div'); actions.className = 'viewer-actions';
      const like = document.createElement('button');
      like.className = 'viewer-like';
      const sourceButton = card.querySelector('.like-btn');
      const liked = sourceButton?.dataset.liked === 'true';
      like.setAttribute('aria-pressed', String(liked));
      like.setAttribute('aria-label', liked ? 'Unlike post' : 'Like post');
      const heartIcon = sourceButton.querySelector('svg').cloneNode(true);
      heartIcon.setAttribute('aria-hidden', 'true');
      const likeCount = document.createElement('span');
      likeCount.textContent = sourceButton.querySelector('.like-count')?.textContent || '0';
      like.append(heartIcon, likeCount);
      like.disabled = pendingPostLikes.has(Number(post.id));
      like.onclick = async () => {
        const wasLiked = sourceButton.dataset.liked === 'true';
        const pending = toggleStatusLike(Number(post.id), sourceButton);
        renderViewerDetails();
        if (!wasLiked) {
          animateLikeButton(details.querySelector('.viewer-like'));
          animatePhotoHeart(stage);
        }
        await pending;
        if (!imageLightbox.classList.contains('hidden') && lightboxTrigger?.closest('[data-post-id]')?.dataset.postId === String(post.id)) {
          const current = details.querySelector('.viewer-like');
          // Keep the same node so a quick response does not cut off the heart animation.
          const nowLiked = sourceButton.dataset.liked === 'true';
          current.disabled = false;
          current.setAttribute('aria-pressed', String(nowLiked));
          current.setAttribute('aria-label', nowLiked ? 'Unlike post' : 'Like post');
          current.querySelector('svg').setAttribute('fill', nowLiked ? 'currentColor' : 'none');
          current.querySelector('span').textContent = sourceButton.querySelector('.like-count').textContent;
          current.focus({ preventScroll: true });
        }
      };
      const comments = document.createElement('button'); comments.textContent = `${post.comment_count || 0} comments`;
      comments.onclick = () => { closePostImage(); togglePostComments(Number(post.id), card); };
      actions.append(like, comments); details.append(author, time, caption, actions);
    }

    const stage = document.getElementById('lightboxStage');
    const pointers = new Map();
    let photoZoom = 1, photoX = 0, photoY = 0, pinch = null, drag = null, moved = false, usedPinch = false, lastPhotoTap = 0;
    function paintPhoto(animate = false) {
      const maxX = Math.max(0, (lightboxImg.clientWidth * photoZoom - stage.clientWidth) / 2);
      const maxY = Math.max(0, (lightboxImg.clientHeight * photoZoom - stage.clientHeight) / 2);
      photoX = Math.max(-maxX, Math.min(maxX, photoX)); photoY = Math.max(-maxY, Math.min(maxY, photoY));
      lightboxImg.style.transition = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'transform 220ms ease-out' : 'none';
      lightboxImg.style.transform = `translate(${photoX}px, ${photoY}px) scale(${photoZoom})`;
      lightboxImg.style.cursor = photoZoom > 1 ? 'grab' : 'zoom-in';
    }
    function resetPhotoZoom() { safariGesture = null; pointers.clear(); pinch = null; drag = null; photoZoom = 1; photoX = photoY = 0; lastPhotoTap = 0; paintPhoto(); }
    function zoomPhoto(target, clientX, clientY, animate) {
      const rect = stage.getBoundingClientRect();
      const mx = clientX - rect.left - rect.width / 2, my = clientY - rect.top - rect.height / 2;
      const next = Math.max(1, Math.min(4, target)), ratio = next / photoZoom;
      photoX = mx - (mx - photoX) * ratio; photoY = my - (my - photoY) * ratio; photoZoom = next;
      paintPhoto(animate);
    }
    stage.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault(); stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) { moved = false; usedPinch = false; drag = { x: event.clientX, y: event.clientY, px: photoX, py: photoY }; }
      if (pointers.size === 2) {
        moved = true; usedPinch = true; lastPhotoTap = 0;
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: photoZoom };
      }
    });
    stage.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        zoomPhoto(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, (a.x + b.x) / 2, (a.y + b.y) / 2, false);
      } else if (drag) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > 8) moved = true;
        if (photoZoom > 1) { photoX = drag.px + dx; photoY = drag.py + dy; paintPhoto(); }
      }
    });
    function endPhotoPointer(event) {
      if (!pointers.has(event.pointerId)) return;
      const cancelled = event.type === 'pointercancel';
      pointers.delete(event.pointerId);
      if (!cancelled && !moved && !pointers.size) {
        const now = Date.now();
        if (now - lastPhotoTap < 300) { zoomPhoto(photoZoom > 1 ? 1 : 2.5, event.clientX, event.clientY, true); lastPhotoTap = 0; }
        else lastPhotoTap = now;
      } else if (!cancelled && !usedPinch && photoZoom === 1 && drag && !pointers.size && galleryImages.length > 1) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.abs(dx) > 60 && Math.abs(dy) < 50) showLightboxIndex(galleryIndex + (dx < 0 ? 1 : -1));
      }
      pinch = null;
      const remaining = [...pointers.values()][0];
      drag = remaining ? { ...remaining, px: photoX, py: photoY } : null;
    }
    stage.addEventListener('pointerup', endPhotoPointer);
    stage.addEventListener('pointercancel', endPhotoPointer);
    // Trackpads use Ctrl+wheel in Chrome/Firefox and GestureEvent in Safari.
    // Listen on the whole viewer so a pinch still works when the cursor is over its caption.
    let safariGesture = null;
    const gesturePoint = event => {
      const rect = stage.getBoundingClientRect();
      return {
        x: Number.isFinite(event.clientX) && event.clientX !== 0 ? event.clientX : rect.left + rect.width / 2,
        y: Number.isFinite(event.clientY) && event.clientY !== 0 ? event.clientY : rect.top + rect.height / 2,
      };
    };
    imageLightbox.addEventListener('wheel', event => {
      if (imageLightbox.classList.contains('hidden')) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (safariGesture) return; // Some Safari versions also emit wheel during GestureEvent.
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
        const point = gesturePoint(event);
        zoomPhoto(photoZoom * Math.exp(-delta * .01), point.x, point.y, false);
      } else if (stage.contains(event.target)) {
        // Two-finger scrolling pans a magnified photo; it must not change the zoom.
        event.preventDefault();
        if (photoZoom > 1) {
          photoX -= event.deltaX; photoY -= event.deltaY; paintPhoto();
        }
      }
    }, { passive: false, capture: true });
    document.addEventListener('gesturestart', event => {
      if (imageLightbox.classList.contains('hidden')) return;
      event.preventDefault();
      safariGesture = { zoom: photoZoom, scale: Number(event.scale) || 1 };
      lastPhotoTap = 0;
    }, { passive: false, capture: true });
    document.addEventListener('gesturechange', event => {
      if (!safariGesture || imageLightbox.classList.contains('hidden')) return;
      event.preventDefault();
      if (pointers.size >= 2) return; // Touchscreen pointers already own this pinch.
      const point = gesturePoint(event);
      zoomPhoto(safariGesture.zoom * (Number(event.scale) || 1) / safariGesture.scale, point.x, point.y, false);
    }, { passive: false, capture: true });
    document.addEventListener('gestureend', event => {
      if (imageLightbox.classList.contains('hidden')) return;
      event.preventDefault(); safariGesture = null;
    }, { passive: false, capture: true });
    window.addEventListener('resize', () => paintPhoto());

    let feedSwipe = null;
    document.querySelector('main.feed').addEventListener('touchstart', event => {
      if (event.touches.length !== 1 || event.target.closest('input, textarea, button, a, .post-image')) { feedSwipe = null; return; }
      feedSwipe = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
    }, { passive: true });
    document.querySelector('main.feed').addEventListener('touchend', event => {
      if (!feedSwipe || !event.changedTouches.length) return;
      const touch = event.changedTouches[0];
      if (Date.now() - feedSwipe.time < 600 && touch.clientX - feedSwipe.x > 100 && Math.abs(touch.clientY - feedSwipe.y) < 45) window.location.assign('/library.html');
      feedSwipe = null;
    }, { passive: true });

    document.getElementById('feedGamesShortcut').addEventListener('click', () => {
      // Preserve the direct app link; provide a download fallback without redirecting the browser.
      document.getElementById('gamesAppHint').hidden = false;
    });
