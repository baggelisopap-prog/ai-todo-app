import { useTranslation } from 'react-i18next';
import VoiceButton from './VoiceButton';
import PhotoButton from './PhotoButton';

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function FloatingActionButtons({ onAddClick, onVoiceComplete, onPhotoComplete }) {
  const { t } = useTranslation();

  return (
    <div className="fixed bottom-24 right-4 z-30 flex flex-col gap-3 items-end">
      <VoiceButton onComplete={onVoiceComplete} />
      <div className="relative flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onAddClick}
          aria-label={t('actions.add')}
          className="w-12 h-12 rounded-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white shadow-[var(--shadow-fab)] flex items-center justify-center transition-colors"
        >
          <PlusIcon />
        </button>
        <span className="text-xs text-[var(--text-secondary)] text-center min-w-[56px]">
          {t('actions.add_label')}
        </span>
      </div>
      <PhotoButton onComplete={onPhotoComplete} />
    </div>
  );
}

export default FloatingActionButtons;
