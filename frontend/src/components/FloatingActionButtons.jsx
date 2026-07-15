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

function FloatingActionButtons({ onAddClick, onVoiceComplete, onPhotoComplete }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
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

  function handleCameraClick() {
    setIsOpen(false);
    cameraRef.current?.trigger();
  }

  function handleGalleryClick() {
    setIsOpen(false);
    galleryRef.current?.trigger();
  }

  return (
    <>
      {/* These mount only their recording overlay / file-picker + preview UI; the
          idle FABs they used to render are replaced by the Speed Dial sub-buttons below. */}
      <VoiceButton ref={voiceRef} onComplete={onVoiceComplete} renderIdleButton={false} />
      <PhotoButton ref={cameraRef} onComplete={onPhotoComplete} renderIdleButton={false} mode="camera" />
      <PhotoButton ref={galleryRef} onComplete={onPhotoComplete} renderIdleButton={false} mode="gallery" />

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-20"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className="fixed bottom-24 right-4 z-30 flex flex-col items-end gap-3 pointer-events-none">
        <div
          className={`flex flex-col items-end gap-3 transition-all duration-200 ${
            isOpen
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          <SubButton label={t('voice.label')} icon={<MicIcon className="w-5 h-5" />} onClick={handleVoiceClick} />
          <SubButton label={t('actions.add_label')} icon={<PlusIcon className="w-5 h-5" />} onClick={handleTextClick} />
          <SubButton label={t('fab.camera')} icon={<CameraIcon className="w-5 h-5" />} onClick={handleCameraClick} />
          <SubButton label={t('fab.gallery')} icon={<GalleryIcon className="w-5 h-5" />} onClick={handleGalleryClick} />
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
  );
}

export default FloatingActionButtons;
