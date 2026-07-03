import { useTranslation } from 'react-i18next';
import VoiceButton from './VoiceButton';

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function FloatingActionButtons({ onAddClick, onVoiceComplete }) {
  const { t } = useTranslation();

  return (
    <div className="fixed bottom-24 right-4 flex flex-col gap-3 z-30 items-center">
      <VoiceButton onComplete={onVoiceComplete} />
      <button
        type="button"
        onClick={onAddClick}
        aria-label={t('actions.add')}
        className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

export default FloatingActionButtons;
