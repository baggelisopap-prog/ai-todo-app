import { useTranslation } from 'react-i18next';
import { useBoards } from '../hooks/useBoards';
import { showModeSwitch } from '../utils/boards';
import { BoardsIcon, TasksIcon } from './icons';

/**
 * The switch between the tasks and board mode (2026-10-12) — see BOARDS_TAB in
 * utils/boards.js for what board mode is.
 *
 * It says, in a word, WHERE IT TAKES YOU: «Πίνακες» from the tasks, «Εργασίες»
 * from the boards. A lit-up icon was the first idea and was dropped while
 * drawing the mockups: an icon alone means nothing to a colleague who has never
 * made a board, and a word naming the destination also answers "which mode am
 * I in?" without a second signal — the title says where you are, this says
 * where you can go.
 *
 * Drawn in two places, by the owner's ask after the first mockup: the top bar
 * (task screens and the list of boards) and an open board's own bar, so the
 * way back to the tasks is never more than one tap from anywhere in board
 * mode. In the board's bar it costs the board's name some width; measured on
 * the mockup, «Ανακαίνιση Pine Lodge» clips at 390px.
 */
function BoardModeSwitch({ inBoards, onSwitch }) {
  const { t } = useTranslation();
  const { boards, isLoaded } = useBoards();

  if (!showModeSwitch({ inBoards, boardCount: boards.length, isLoaded })) return null;

  const Icon = inBoards ? TasksIcon : BoardsIcon;
  return (
    <button
      type="button"
      onClick={onSwitch}
      className="tap-44 flex-shrink-0 inline-flex items-center gap-1.5 h-[34px] pl-2.5 pr-3 rounded-full border border-[var(--border-medium)] bg-[var(--bg-card)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
    >
      <Icon className="w-[18px] h-[18px] text-[var(--brand-primary)]" />
      <span>{inBoards ? t('boards.mode_exit') : t('boards.mode_enter')}</span>
    </button>
  );
}

export default BoardModeSwitch;
