/**
 * dsh-image-viewer — the browser half.
 *
 * This file IS the served bundle, not a module the shell imports: the client
 * module system evaluates it once at boot, and `window.__ModuleLoader__.load`
 * registers the factory that materializes the plugin. Everything the factory
 * needs lives inside it, so the whole file is self-contained plain JavaScript
 * (no JSX, no TypeScript, no bundler step) and `require` resolves only against
 * the shell's frozen platform table — `react` is the one entry used here.
 *
 * THREE CONTRIBUTIONS
 *   1. `tool.call.toolview` keyed by `read_image` — clicking the model's image
 *      read expands the picture inline instead of leaving a filename row.
 *   2. `sidebar.footer.action` — a toggle beside Settings.
 *   3. `shell.overlay` — the workspace image drawer that toggle opens, with a
 *      lightbox for any picture in it.
 *
 * The node half serves `/image-viewer`, so this half talks to it with plain
 * same-origin `fetch`. Keep ROUTE in sync with the host half's `route` config.
 */

window.__ModuleLoader__.load({
	id: 'dsh-image-viewer',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');

		const PLUGIN_ID = 'dsh-image-viewer';
		/** Must match the host half's `route` config. */
		const ROUTE = '/image-viewer';
		const CSS_TAG_ID = PLUGIN_ID + '/styles.css';

		const h = React.createElement;

		/* ── styles ─────────────────────────────────────────────────────────── */

		const CSS = [
			'.diw-root{--diw-border:var(--dsw-alias-border-l1,rgba(128,128,128,.28));--diw-surface:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1c1c1e));--diw-text:var(--dsw-alias-label-primary,#e8e8ea);--diw-text-dim:var(--dsw-alias-label-secondary,#9a9aa2);--diw-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));font-size:13px;color:var(--diw-text)}',
			'.diw-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--diw-text-dim);font:inherit;cursor:pointer}',
			'.diw-btn:hover{background:var(--diw-hover);color:var(--diw-text)}',
			'.diw-btn:disabled{opacity:.45;cursor:default}',
			'.diw-btn[data-active="true"]{background:var(--diw-hover);color:var(--diw-text)}',
			'.diw-btnIcon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--diw-text-dim);cursor:pointer}',
			'.diw-btnIcon:hover{background:var(--diw-hover);color:var(--diw-text)}',

			/* drawer */
			'.diw-drawer{position:fixed;top:64px;right:16px;bottom:72px;z-index:60;display:flex;flex-direction:column;width:min(380px,calc(100vw - 32px));pointer-events:auto;background:var(--diw-surface);border:1px solid var(--diw-border);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.28);overflow:hidden}',
			'.diw-drawerHead{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;border-bottom:1px solid var(--diw-border)}',
			'.diw-drawerTitle{flex:1;min-width:0;font-weight:600;font-size:13px}',
			'.diw-drawerSub{padding:8px 14px;color:var(--diw-text-dim);font-size:12px;border-bottom:1px solid var(--diw-border)}',
			'.diw-filter{width:100%;box-sizing:border-box;height:28px;margin:8px 0 0;padding:0 8px;border:1px solid var(--diw-border);border-radius:8px;background:transparent;color:var(--diw-text);font:inherit;outline:none}',
			'.diw-filter:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
			'.diw-body{flex:1;overflow:auto;padding:10px 12px 14px}',
			'.diw-group{margin:0 0 12px}',
			'.diw-groupTitle{margin:0 0 6px;color:var(--diw-text-dim);font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.diw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px}',
			'.diw-cell{position:relative;aspect-ratio:1/1;padding:0;border:1px solid var(--diw-border);border-radius:10px;background:var(--diw-hover);overflow:hidden;cursor:zoom-in}',
			'.diw-cell img{width:100%;height:100%;object-fit:cover;display:block}',
			'.diw-cellName{position:absolute;left:0;right:0;bottom:0;padding:3px 6px;background:linear-gradient(transparent,rgba(0,0,0,.72));color:#fff;font-size:10px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.diw-state{padding:18px 4px;color:var(--diw-text-dim);font-size:12px;line-height:1.6;text-align:center}',
			'.diw-bad{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--diw-text-dim);font-size:10px}',

			/* lightbox */
			'.diw-lb{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;pointer-events:auto;background:rgba(0,0,0,.78);backdrop-filter:blur(3px)}',
			'.diw-lbImg{max-width:calc(100vw - 72px);max-height:calc(100vh - 128px);object-fit:contain;border-radius:10px;background:var(--diw-surface);box-shadow:0 16px 48px rgba(0,0,0,.5)}',
			'.diw-lbBar{position:fixed;left:0;right:0;bottom:20px;display:flex;justify-content:center;gap:10px}',
			'.diw-lbChip{max-width:60vw;padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}',
			'.diw-lbClose{position:fixed;top:18px;right:18px;width:36px;height:36px;border:0;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:18px;line-height:1;cursor:pointer}',

			/* read_image tool card */
			'.diw-card{display:flex;flex-direction:column;gap:8px;padding:8px 10px;border:1px solid var(--diw-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent)}',
			'.diw-cardHead{display:flex;align-items:center;gap:8px;min-width:0}',
			'.diw-cardTool{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;font-size:12px;font-weight:600;color:var(--diw-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.diw-cardState{flex:none;font-size:11px;color:var(--diw-text-dim)}',
			'.diw-cardState[data-state="running"]{color:var(--dsw-alias-state-warn-primary,#d29922)}',
			'.diw-cardState[data-state="error"]{color:var(--dsw-alias-state-error-primary,#e5534b)}',
			'.diw-cardStatus{margin-left:auto;flex:none;display:flex;align-items:center;gap:8px}',
			'.diw-cardDuration{flex:none;font-size:11px;color:var(--diw-text-dim)}',
			'.diw-cardDetails{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--diw-border);padding-top:8px}',
			'.diw-detailRow{display:flex;flex-direction:column;gap:4px;min-width:0}',
			'.diw-cardLabel{font-size:11px;font-weight:600;color:var(--diw-text-dim)}',
			'.diw-cardPre{margin:0;max-height:240px;overflow:auto;padding:8px;border:1px solid var(--diw-border);border-radius:8px;background:var(--diw-hover);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
			'.diw-cardTop{display:flex;align-items:center;gap:10px;min-width:0}',
			'.diw-cardThumb{flex:none;width:44px;height:44px;padding:0;border:1px solid var(--diw-border);border-radius:8px;background:var(--diw-hover);overflow:hidden;cursor:zoom-in}',
			'.diw-cardThumb img{width:100%;height:100%;object-fit:cover;display:block}',
			'.diw-cardMeta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
			'.diw-cardName{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.diw-cardPath{color:var(--diw-text-dim);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left}',
			'.diw-cardActions{flex:none;display:flex;align-items:center;gap:2px}',
			'.diw-cardOpen{display:block;width:100%;max-height:70vh;object-fit:contain;border-radius:8px;background:var(--diw-hover);cursor:zoom-out}',
			'.diw-cardError{color:var(--dsw-alias-state-error-primary,#e5534b);font-size:12px}',
		].join('\n');

		/**
		 * Inject this bundle's stylesheet once per document and hand back the
		 * removal, so a plugin stop or update leaves no tag behind.
		 * @returns the disposer that removes the injected tag.
		 */
		function insertStyles() {
			if (typeof document === 'undefined') return () => {};
			const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']');
			if (existing !== null) return () => {};
			const tag = document.createElement('style');
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}

		/* ── tiny shared store ──────────────────────────────────────────────── */

		/**
		 * One observable record shared by the sidebar toggle and the overlay
		 * drawer. The two live in different slot trees, so module scope is the
		 * only place they can agree on whether the drawer is open.
		 */
		const store = {
			open: false,
			items: null,
			status: 'idle',
			error: null,
			selected: null,
		};
		const listeners = new Set();

		/**
		 * Merge a patch into the shared store and notify every subscriber.
		 * @param patch - the fields to change.
		 */
		function write(patch) {
			Object.assign(store, patch);
			for (const listener of [...listeners]) listener();
		}

		/** Subscribe to store writes for the component lifetime. */
		function useStore() {
			const [, bump] = React.useState(0);
			React.useEffect(() => {
				const listener = () => bump((n) => n + 1);
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}, []);
			return store;
		}

		/* ── helpers ────────────────────────────────────────────────────────── */

		/**
		 * Resolve a tool argument path against the session workspace root.
		 *
		 * Separators are normalized to `/` so a joined path has exactly one
		 * spelling: the host half converts `/` back to the platform separator
		 * before touching the filesystem, and a single canonical form is what the
		 * card can display and encode without surprising either audience.
		 * @param cwd - the session workspace root, when known.
		 * @param path - an absolute or workspace-relative path.
		 * @returns an absolute path when one can be formed.
		 */
		function resolvePath(cwd, path) {
			if (typeof path !== 'string' || path === '') return '';
			const native = path.replace(/\\/g, '/');
			if (/^[A-Za-z]:\//.test(native) || native.startsWith('/')) return native;
			if (typeof cwd !== 'string' || cwd === '') return native;
			return cwd.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + native.replace(/^\/+/, '');
		}

		/**
		 * Same-origin URL the host half serves one local image from.
		 * @param path - an absolute image path.
		 * @returns the encoded route URL.
		 */
		function imageUrl(path) {
			return ROUTE + '/file?p=' + encodeURIComponent(path);
		}

		/**
		 * Extensions the host route will serve. The route authorizes by extension
		 * on purpose — it must not become a general file-download endpoint — so a
		 * path without one is reported as unpreviewable here rather than rendered
		 * as a broken thumbnail.
		 */
		const IMAGE_EXTENSION = /\.(?:png|jpe?g|jfif|gif|webp|bmp|avif|ico|svg)$/i;

		/** Last path segment, used as a workspace label. */
		function baseName(path) {
			return String(path).replace(/[/\\]+$/, '').split(/[/\\]/).pop() || String(path);
		}

		/** Human-readable byte size. */
		function formatSize(bytes) {
			if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
			if (bytes < 1024) return bytes + ' B';
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
			return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
		}

		/**
		 * Read the model's argument JSON off a running or settled tool call.
		 * @param block - the Tool root lifecycle value.
		 * @returns the parsed arguments, or an empty object.
		 */
		function argsOf(block) {
			const raw = block === null || typeof block !== 'object'
				? ''
				: block.kind === 'tool-result'
					? (block.call === null || block.call === undefined ? '' : String(block.call.argsRaw ?? ''))
					: String(block.argsRaw ?? '');
			if (raw === '') return {};
			try {
				const parsed = JSON.parse(raw);
				return parsed !== null && typeof parsed === 'object' ? parsed : {};
			} catch {
				return {};
			}
		}

		/* ── lightbox ───────────────────────────────────────────────────────── */

		/** Full-frame original-image viewer; Escape or a click on the mask closes it. */
		function Lightbox(props) {
			React.useEffect(() => {
				if (typeof window === 'undefined') return undefined;
				const onKey = (event) => {
					if (event.key === 'Escape') props.onClose();
				};
				window.addEventListener('keydown', onKey);
				return () => {
					window.removeEventListener('keydown', onKey);
				};
			}, [props.onClose]);
			return h(
				'div',
				{
					className: 'diw-root diw-lb',
					role: 'dialog',
					'aria-modal': 'true',
					'aria-label': props.name ?? '图片预览',
					onClick: props.onClose,
				},
				h('img', {
					className: 'diw-lbImg',
					src: props.src,
					alt: props.name ?? '',
					onClick: (event) => event.stopPropagation(),
				}),
				h(
					'div',
					{ className: 'diw-lbBar' },
					h('span', { className: 'diw-lbChip' }, props.name ?? ''),
					h('a', { className: 'diw-lbChip', href: props.src, target: '_blank', rel: 'noreferrer' }, '在新标签打开'),
				),
				h(
					'button',
					{ className: 'diw-lbClose', type: 'button', onClick: props.onClose, 'aria-label': '关闭' },
					'\u00d7',
				),
			);
		}

		/* ── workspace drawer ───────────────────────────────────────────────── */

		/** One thumbnail that degrades to a readable label when the bytes fail. */
		function Cell(props) {
			const [broken, setBroken] = React.useState(false);
			const [shown, setShown] = React.useState(false);
			React.useEffect(() => {
				if (shown) return undefined;
				const id = window.setTimeout(() => setShown(true), props.delay ?? 0);
				return () => {
					window.clearTimeout(id);
				};
			}, [shown, props.delay]);
			return h(
				'button',
				{
					className: 'diw-cell',
					type: 'button',
					title: props.item.rel,
					onClick: () => props.onOpen(props.item),
				},
				broken
					? h('div', { className: 'diw-bad' }, '无法显示')
					: shown
						? h('img', { src: props.item.url, alt: props.item.name, loading: 'lazy', decoding: 'async', onError: () => setBroken(true) })
						: h('div', { className: 'diw-bad' }, '…'),
				h('span', { className: 'diw-cellName' }, props.item.name),
			);
		}

		/** The frame-wide drawer: image index, filter, and lightbox. */
		function Drawer() {
			const state = useStore();
			const [filter, setFilter] = React.useState('');

			const load = React.useCallback(async () => {
				write({ status: 'loading', error: null });
				try {
					const response = await fetch(ROUTE + '/list', { headers: { accept: 'application/json' } });
					if (!response.ok) {
						write({ status: 'error', error: '请求失败：HTTP ' + response.status });
						return;
					}
					const payload = await response.json();
					write({
						status: 'ready',
						items: Array.isArray(payload.images) ? payload.images : [],
						error: null,
						truncated: payload.truncated === true,
					});
				} catch (error) {
					write({ status: 'error', error: '无法连接 Host 路由：' + String(error && error.message ? error.message : error) });
				}
			}, []);

			React.useEffect(() => {
				if (state.open && state.status === 'idle') void load();
			}, [state.open, state.status, load]);

			if (!state.open) return null;

			const needle = filter.trim().toLowerCase();
			const items = state.items === null ? [] : state.items;
			const shown = needle === '' ? items : items.filter((item) => String(item.rel).toLowerCase().includes(needle));
			const groups = new Map();
			for (const item of shown) {
				const key = item.root;
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push(item);
			}

			let body;
			if (state.status === 'loading') body = h('div', { className: 'diw-state' }, '正在扫描工作区…');
			else if (state.status === 'error') body = h('div', { className: 'diw-state' }, state.error);
			else if (items.length === 0) body = h('div', { className: 'diw-state' }, '这个工作区里没有图片。', h('br'), '支持 png / jpg / jpeg / gif / webp / bmp / avif / ico / svg。');
			else if (shown.length === 0) body = h('div', { className: 'diw-state' }, '没有匹配 "' + filter + '" 的图片。');
			else {
				body = [...groups.entries()].map(([root, group]) =>
					h(
						'div',
						{ className: 'diw-group', key: root },
						h('div', { className: 'diw-groupTitle', title: root }, baseName(root) + ' · ' + group.length),
						h(
							'div',
							{ className: 'diw-grid' },
							group.map((item, index) =>
								h(Cell, { item, key: item.path, delay: index < 24 ? 0 : 400, onOpen: (picked) => write({ selected: picked }) }),
							),
						),
					),
				);
			}

			return h(
				'div',
				null,
				h(
					'div',
					{ className: 'diw-root diw-drawer', role: 'complementary', 'aria-label': '工作区图片' },
					h(
						'div',
						{ className: 'diw-drawerHead' },
						h('span', { className: 'diw-drawerTitle' }, '工作区图片'),
						h(
							'button',
							{ className: 'diw-btnIcon', type: 'button', title: '重新扫描', onClick: () => void load(), disabled: state.status === 'loading' },
							'⟳',
						),
						h(
							'button',
							{ className: 'diw-btnIcon', type: 'button', title: '关闭', onClick: () => write({ open: false }), 'aria-label': '关闭' },
							'\u00d7',
						),
					),
					items.length > 0
						? h(
								'div',
								{ className: 'diw-drawerSub' },
								'共 ' + items.length + ' 张' + (state.truncated ? '（已截断）' : ''),
								h('input', {
									className: 'diw-filter',
									type: 'search',
									placeholder: '按路径过滤…',
									value: filter,
									onChange: (event) => setFilter(event.target.value),
								}),
							)
						: null,
					h('div', { className: 'diw-body' }, body),
				),
				state.selected === null
					? null
					: h(Lightbox, {
							src: state.selected.url,
							name: state.selected.name,
							onClose: () => write({ selected: null }),
						}),
			);
		}

		/** Sidebar-foot toggle beside Settings. */
		function SidebarToggle(props) {
			const state = useStore();
			const wide = props.wide !== false;
			return h(
				'button',
				{
					className: wide ? 'diw-root diw-btn' : 'diw-root diw-btnIcon',
					type: 'button',
					title: '工作区图片',
					'aria-label': '工作区图片',
					'data-active': state.open ? 'true' : 'false',
					onClick: () => write({ open: !state.open }),
				},
				h('span', { 'aria-hidden': 'true' }, '🖼'),
				wide ? h('span', null, '图片') : null,
			);
		}

		/* ── read_image tool card ───────────────────────────────────────────── */

		/**
		 * The raw argument text of a call, in whichever shape the block has: a
		 * running call carries `argsRaw` directly, a settled one carries it on
		 * the backfilled call head and may have none at all when window
		 * truncation left the call outside.
		 * @param block - the Tool root lifecycle value.
		 * @returns the raw JSON text, or an empty string.
		 */
		function rawArgsOf(block) {
			if (block === null || typeof block !== 'object') return '';
			if (block.kind !== 'tool-result') return String(block.argsRaw ?? '');
			const call = block.call;
			return call === null || call === undefined ? '' : String(call.argsRaw ?? '');
		}

		/**
		 * Re-indent one JSON text for display, leaving anything unparsable
		 * exactly as it was written.
		 * @param text - raw JSON text.
		 * @returns the text to show.
		 */
		function prettyJson(text) {
			if (typeof text !== 'string' || text === '') return '';
			try {
				return JSON.stringify(JSON.parse(text), null, 2);
			} catch {
				return text;
			}
		}

		/**
		 * The visible text of a settled result, naming any block type this card
		 * has no better way to show.
		 *
		 * Only leaf scalars are read: an image block holds a live attachment
		 * reference, which is never serialized or displayed here.
		 * @param block - the Tool root lifecycle value.
		 * @returns one line per result block.
		 */
		function resultText(block) {
			if (block === null || typeof block !== 'object' || block.kind !== 'tool-result') return '';
			if (!Array.isArray(block.content)) return '';
			const lines = [];
			for (const item of block.content) {
				if (item === null || typeof item !== 'object') continue;
				if (item.type === 'text' && typeof item.text === 'string') lines.push(item.text);
				else if (typeof item.type === 'string') lines.push('[' + item.type + ']');
			}
			return lines.join('\n');
		}

		/**
		 * How long a settled call took, from the two timestamps its node carries.
		 *
		 * A running call reports nothing rather than a figure that was only true
		 * at the instant it rendered: this card owns no timer, and a timestamp
		 * frozen into a card that never re-renders reads as a lie.
		 * @param block - the Tool root lifecycle value.
		 * @returns the human-readable duration, or an empty string.
		 */
		function durationOf(block) {
			if (block === null || typeof block !== 'object' || block.kind !== 'tool-result') return '';
			const started = block.callTime;
			const ended = block.time;
			if (typeof started !== 'number' || typeof ended !== 'number') return '';
			const ms = ended - started;
			if (!Number.isFinite(ms) || ms < 0) return '';
			if (ms < 1000) return String(Math.round(ms)) + ' ms';
			if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
			return String(Math.floor(ms / 60000)) + ' min ' + String(Math.round((ms % 60000) / 1000)) + ' s';
		}

		/**
		 * Keyed view for the model's `read_image` calls.
		 *
		 * This card REPLACES the generic tool row for this one tool, so it also
		 * carries everything that row carried: which tool was called, how far it
		 * got, how long it took, and — behind the 详情 toggle — the raw argument
		 * JSON and the result text. All of it renders on every path, including
		 * the degraded ones: a card that showed only a thumbnail would leave the
		 * reader unable to tell a tool call from an image someone attached.
		 */
		function ReadImageCard(props) {
			const [expanded, setExpanded] = React.useState(false);
			const [broken, setBroken] = React.useState(false);
			const [details, setDetails] = React.useState(false);

			const block = props.block;
			const args = argsOf(block);
			const raw = typeof args.file_path === 'string' ? args.file_path : '';
			const absolute = resolvePath(props.cwd, raw);
			const settled = block !== null && typeof block === 'object' && block.kind === 'tool-result';
			const failed = settled && block.isError === true;
			const previewable = absolute !== '' && IMAGE_EXTENSION.test(absolute);
			const src = previewable ? imageUrl(absolute) : '';
			const name = absolute === '' ? '' : baseName(absolute);
			const duration = durationOf(block);

			const rows = [];
			const argsText = prettyJson(rawArgsOf(block));
			if (argsText !== '') rows.push(['参数', argsText]);
			if (settled) {
				const output = resultText(block);
				rows.push(['结果', output === '' ? '（没有文本内容）' : output]);
				const error = block.error;
				if (error !== null && error !== undefined) {
					rows.push(['错误', String(error.name ?? '') + ' / ' + String(error.code ?? '')]);
				}
			}
			const detailsPanel = details
				? h(
						'div',
						{ className: 'diw-cardDetails' },
						rows.length === 0
							? h('div', { className: 'diw-cardPath' }, '这次调用没有可显示的参数或结果。')
							: rows.map((row) =>
									h(
										'div',
										{ className: 'diw-detailRow', key: row[0] },
										h('span', { className: 'diw-cardLabel' }, row[0]),
										h('pre', { className: 'diw-cardPre' }, row[1]),
									),
								),
					)
				: null;

			const head = h(
				'div',
				{ className: 'diw-cardHead' },
				h(
					'span',
					{ className: 'diw-cardTool' },
					typeof props.toolName === 'string' && props.toolName !== '' ? props.toolName : 'read_image',
				),
				h(
					'span',
					{ className: 'diw-cardStatus' },
					duration === '' ? null : h('span', { className: 'diw-cardDuration' }, duration),
					h(
						'span',
						{ className: 'diw-cardState', 'data-state': failed ? 'error' : settled ? 'done' : 'running' },
						failed ? '失败' : settled ? '已完成' : '运行中',
					),
				),
			);

			const detailsButton = h(
				'button',
				{
					className: 'diw-btn',
					type: 'button',
					'data-active': details ? 'true' : 'false',
					onClick: () => setDetails((value) => !value),
				},
				details ? '收起详情' : '详情',
			);

			if (!previewable) {
				return h(
					'div',
					{ className: 'diw-root diw-card' },
					head,
					h(
						'div',
						{ className: 'diw-cardTop' },
						h(
							'div',
							{ className: 'diw-cardMeta' },
							h(
								'span',
								{ className: 'diw-cardPath', title: absolute },
								absolute === ''
									? '未提供 file_path'
									: absolute + ' —— 没有可识别的图片扩展名，路由不提供预览；read_image 的原图仍由会话自身的图片渲染展示。',
							),
						),
						h('div', { className: 'diw-cardActions' }, detailsButton),
					),
					detailsPanel,
				);
			}

			return h(
				'div',
				{ className: 'diw-root diw-card' },
				head,
				h(
					'div',
					{ className: 'diw-cardTop' },
					h(
						'button',
						{
							className: 'diw-cardThumb',
							type: 'button',
							title: expanded ? '收起' : '展开查看',
							onClick: () => setExpanded((value) => !value),
						},
						broken
							? h('div', { className: 'diw-bad' }, '×')
							: h('img', { src, alt: name, loading: 'lazy', decoding: 'async', onError: () => setBroken(true) }),
					),
					h(
						'div',
						{ className: 'diw-cardMeta' },
						h('span', { className: 'diw-cardName' }, name),
						h('span', { className: 'diw-cardPath', title: absolute }, absolute),
						failed ? h('span', { className: 'diw-cardError' }, '读取失败') : null,
					),
					h(
						'div',
						{ className: 'diw-cardActions' },
						h(
							'button',
							{ className: 'diw-btn', type: 'button', onClick: () => setExpanded((value) => !value) },
							expanded ? '收起' : '展开',
						),
						h('a', { className: 'diw-btn', href: src, target: '_blank', rel: 'noreferrer' }, '查看'),
						detailsButton,
					),
				),
				expanded
					? h('img', {
							className: 'diw-cardOpen',
							src,
							alt: name,
							decoding: 'async',
							onClick: () => setExpanded(false),
							onError: () => setBroken(true),
						})
					: null,
				detailsPanel,
			);
		}

		/* ── plugin ─────────────────────────────────────────────────────────── */

		/**
		 * Register this bundle's three slot entries.
		 * @param ctx - the client Cordis context; `slots` is a declared dependency.
		 */
		function apply(ctx) {
			ctx.effect(() => insertStyles(), PLUGIN_ID + ': stylesheet');
			ctx.slots.inject('tool.call.toolview', () =>
				ctx.slots.register({ name: 'tool.call.toolview', key: 'read_image' }, ReadImageCard),
			);
			ctx.slots.inject('sidebar.footer.action', () =>
				ctx.slots.register({ name: 'sidebar.footer.action', id: PLUGIN_ID, order: 20, label: '工作区图片' }, SidebarToggle),
			);
			ctx.slots.inject('shell.overlay', () =>
				ctx.slots.register({ name: 'shell.overlay', id: PLUGIN_ID, order: 40, label: '工作区图片' }, Drawer),
			);
		}

		const inject = ['slots'];

		exports.Drawer = Drawer;
		exports.Lightbox = Lightbox;
		exports.ReadImageCard = ReadImageCard;
		exports.SidebarToggle = SidebarToggle;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
