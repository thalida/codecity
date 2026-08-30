// constants/ui.ts — UI metadata that isn't user-tunable.

/** Max number of recently-opened sources kept in the source-picker MRU list
 *  (oldest dropped past this). */
export const MAX_RECENT_SOURCES = 10;

/** The codecity repo itself, base for the header's repo link and the
 *  README-anchor deep links used elsewhere in the UI. */
export const REPO_URL = 'https://github.com/thalida/codecity';

/** README anchors deep-linked from more than one surface. */
export const RUN_DOCS_URL = `${REPO_URL}#run-it-yourself`;
export const EXCLUDES_DOCS_URL = `${REPO_URL}#skipped-by-default`;

/** The author's site, linked from the footer credit. */
export const CREATOR_URL = 'https://thalida.com';
