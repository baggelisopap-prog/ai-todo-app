import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceButton from './VoiceButton';
import PhotoButton from './PhotoButton';
import { PlusIcon, MicIcon, CameraIcon, GalleryIcon } from './icons';

function SubButton({ label, icon, onClick }) {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-[var(--bg-card)] text-[var(--text-primary)] text-sm font-medium px-3 py-1.5 rounded-full shadow-[var(--shadow-card)] border border-[var(--border-subtle)]">
        {label}
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="w-12 h-12 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--brand-primary)] shadow-[var(--shadow-fab)] flex items-center justify-center hover:bg-[var(--bg-hover)] transition-colors"
      >
        {icon}
      </button>
    </div>
  );
}

/** One line of the desktop sidebar's dropdown — the same three actions the
 *  phone's dial offers, laid out as a menu because a dial that fans out from a
 *  round button is an idiom for a thumb, not a pointer. */
function MenuItem({ label, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] text-left transition-colors"
    >
      <span className="text-[var(--text-secondary)]">{icon}</span>
      {label}
    </button>
  );
}

/**
 * The three ways to add a task — typing, dictating, photographing — behind one
 * control, plus the machinery all three need.
 *
 * `variant` picks the shape, never the behaviour:
 *   'fab'     — the phone's round button, bottom right, fanning upward.
 *   'sidebar' — a full-width "Νέα εργασία" button at the top of SideNav, with
 *               the same three choices in a dropdown under it.
 * Exactly one instance is mounted at a time (App branches on window width),
 * because each instance mounts a microphone and two file pickers.
 */
function FloatingActionButtons({ onAddClick, onVoiceComplete, onPhotoComplete, variant = 'fab' }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showPhotoChoice, setShowPhotoChoice] = useState(false);
  const voiceRef = useRef(null);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  function handleVoiceClick() {
    setIsOpen(false);
    voiceRef.current?.trigger();
  }

  function handleTextClick() {
    setIsOpen(false);
    onAddClick();
  }

  function handlePhotoClick() {
    setIsOpen(false);
    setShowPhotoChoice(true);
  }

  function handleTakePhoto() {
    setShowPhotoChoice(false);
    cameraRef.current?.trigger();
  }

  function handleChooseFromGallery() {
    setShowPhotoChoice(false);
    galleryRef.current?.trigger();
  }

  return (
    <>
      {/* These mount only their recording overlay / file-picker + preview UI; the
          idle FABs they used to render are replaced by the Speed Dial sub-buttons below. */}
      <VoiceButton ref={voiceRef} onComplete={onVoiceComplete} renderIdleButton={false} />
      <PhotoButton ref={cameraRef} onComplete={onPhotoComplete} renderIdleButton={false} mode="camera" />
      <PhotoButton ref={galleryRef} onComplete={onPhotoComplete} renderIdleButton={false} mode="gallery" />

      {variant === 'sidebar' ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-[var(--text-inverse)] text-sm font-semibold transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            {t('fab.new_task')}
          </button>

          {isOpen && (
            <>
              {/* Invisible, and that is the point: a click anywhere else
                  closes the menu. Transparent rather than dimmed, because on
                  a wide screen this menu covers a corner, not the screen. */}
              <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
              <div className="absolute left-0 right-0 top-full mt-1 z-40 p-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-[var(--shadow-menu)] animate-fade-in">
                <MenuItem label={t('voice.label')} icon={<MicIcon className="w-4 h-4" />} onClick={handleVoiceClick} />
                <MenuItem label={t('actions.add_label')} icon={<PlusIcon className="w-4 h-4" />} onClick={handleTextClick} />
                <MenuItem label={t('fab.photo')} icon={<CameraIcon className="w-4 h-4" />} onClick={handlePhotoClick} />
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {isOpen && (
            <div
              className="fixed inset-0 bg-black/20 animate-fade-in z-20"
              onClick={() => setIsOpen(false)}
            />
          )}

          <div className="fixed bottom-safe-24 right-4 z-30 flex flex-col items-end gap-3 pointer-events-none">
            <div
              className={`flex flex-col items-end gap-3 transition-all duration-200 ${
                isOpen
                  ? 'opacity-100 translate-y-0 pointer-events-auto'
                  : 'opacity-0 translate-y-2 pointer-events-none'
              }`}
            >
              <SubButton label={t('voice.label')} icon={<MicIcon className="w-5 h-5" />} onClick={handleVoiceClick} />
              <SubButton label={t('actions.add_label')} icon={<PlusIcon className="w-5 h-5" />} onClick={handleTextClick} />
              <SubButton label={t('fab.photo')} icon={<CameraIcon className="w-5 h-5" />} onClick={handlePhotoClick} />
            </div>

            <button
              type="button"
              onClick={() => setIsOpen((open) => !open)}
              aria-label={isOpen ? t('fab.close') : t('fab.open')}
              className="w-16 h-16 rounded-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white shadow-[var(--shadow-fab)] flex items-center justify-center transition-all duration-200 pointer-events-auto"
            >
              <PlusIcon className={`w-6 h-6 transition-transform duration-200 ${isOpen ? 'rotate-45' : ''}`} />
            </button>
          </div>
        </>
      )}

      {showPhotoChoice && (
        <div
          className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center p-4"
          onClick={() => setShowPhotoChoice(false)}
        >
          <div
            className="w-full md:max-w-xs bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleTakePhoto}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-left"
            >
              <CameraIcon className="w-5 h-5 text-[var(--text-secondary)]" />
              <span>{t('photo.take_photo')}</span>
            </button>
            <button
              type="button"
              onClick={handleChooseFromGallery}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-left"
            >
              <GalleryIcon className="w-5 h-5 text-[var(--text-secondary)]" />
              <span>{t('photo.choose_from_gallery')}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default FloatingActionButtons;
