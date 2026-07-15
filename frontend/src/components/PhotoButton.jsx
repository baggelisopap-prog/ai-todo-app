import { forwardRef, useState, useRef, useEffect, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { extractTasksFromImage } from '../api';
import { CameraIcon, SpinnerIcon } from './icons';

const PhotoButton = forwardRef(function PhotoButton({ onComplete, renderIdleButton = true, mode = 'gallery' }, ref) {
  const { t } = useTranslation();
  const [state, setState] = useState('idle'); // idle | preview | processing
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [contextText, setContextText] = useState('');
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

  useImperativeHandle(ref, () => ({
    trigger: () => fileInputRef.current?.click(),
  }));

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
    setContextText('');
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
      const result = await extractTasksFromImage(imageFile, contextText);
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
      {renderIdleButton && (
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
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture={mode === 'camera' ? 'environment' : undefined}
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

            <textarea
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              placeholder={t('photo.context_placeholder')}
              rows={2}
              disabled={isProcessing}
              className="w-full mt-3 px-3 py-2 rounded-md border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] bg-[var(--bg-card)] resize-none disabled:opacity-60"
            />

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
                {isProcessing && <SpinnerIcon className="w-4 h-4 animate-spin" />}
                {isProcessing ? t('photo.processing') : t('photo.extract')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default PhotoButton;
