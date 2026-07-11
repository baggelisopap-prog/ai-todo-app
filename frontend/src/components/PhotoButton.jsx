import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { extractTasksFromImage } from '../api';

function CameraIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function PhotoButton({ onComplete }) {
  const { t } = useTranslation();
  const [state, setState] = useState('idle'); // idle | preview | processing
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);

  // Revoke the previous object URL whenever it changes, and on unmount.
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function handleButtonClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be selected again
    if (!file) return;
    setError(null);
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setState('preview');
  }

  function cleanup() {
    setImageFile(null);
    setImageUrl(null);
    setError(null);
    setState('idle');
  }

  function handleCancel() {
    cleanup();
  }

  async function handleExtract() {
    if (!imageFile) return;
    setState('processing');
    setError(null);
    try {
      const result = await extractTasksFromImage(imageFile);
      onComplete(result.saved_tasks);
      cleanup();
    } catch (err) {
      setError(err.message);
      setState('preview');
    }
  }

  const isProcessing = state === 'processing';
  const showModal = state === 'preview' || state === 'processing';

  return (
    <>
      <div className="relative flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={handleButtonClick}
          aria-label={t('photo.label')}
          className="w-12 h-12 rounded-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white shadow-[var(--shadow-fab)] flex items-center justify-center transition-colors"
        >
          <CameraIcon className="w-5 h-5" />
        </button>
        <span className="text-xs text-[var(--text-secondary)] text-center min-w-[56px]">
          {t('photo.label')}
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={isProcessing ? undefined : handleCancel}
        >
          <div
            className="bg-[var(--bg-modal)] rounded-lg max-w-md w-full p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
              {t('photo.preview_title')}
            </h2>
            <img src={imageUrl} alt="preview" className="w-full h-auto rounded max-h-96 object-contain" />

            {error && (
              <div className="mt-3 p-2 rounded-md border border-red-200 bg-red-50 text-red-800 text-xs">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isProcessing}
                className="px-4 py-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {t('photo.retake')}
              </button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={isProcessing}
                className="px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white font-medium inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing && <SpinnerIcon />}
                {isProcessing ? t('photo.processing') : t('photo.extract')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PhotoButton;
