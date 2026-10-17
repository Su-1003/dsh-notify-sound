window.__ModuleLoader__.load({
	id: "dsh-notify-sound",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");

		//#region 通知类型
		/**
		 * 三种提醒场景。声音统一（同音双响），
		 * 场景差异只体现在界面通知条的文字与颜色上。
		 */
		const KINDS = {
			done: { label: "任务完成", detail: "已答完一轮，停下来等你", color: "#2ea043" },
			confirm: { label: "需要你确认", detail: "有操作在等你的授权", color: "#d29922" },
			error: { label: "出错 / 被中断", detail: "这次运行没有正常结束", color: "#f85149" }
		};
		/** 一条通知在界面上停留多久（毫秒）。 */
		const NOTICE_TTL_MS = 20000;
		/** 同类通知的最小间隔，避免连续事件把声音刷爆。 */
		const MIN_GAP_MS = 1500;
		//#endregion

		//#region 音色库
		/**
		 * 可选音色。每种音色定义波形、包络与音符走向。
		 *
		 * 按用户要求：三种场景（完成 / 确认 / 出错）**统一使用同音双响**，
		 * 声音上不做区分；场景差异只体现在界面通知条的文字与颜色上，
		 * 因此三种 shape 都取同一个 call 音型。
		 */
		const CALL_SHAPE = {
			done: [880, 880],
			confirm: [880, 880],
			error: [880, 880]
		};
		const SOUND_SETS = {
			clean: {
				label: "清脆（当前默认）",
				osc: "sine",
				gain: 0.22,
				attack: 0.02,
				decay: 0.28,
				notes: CALL_SHAPE
			},
			soft: {
				label: "柔和（音量减半、余音稍长）",
				osc: "sine",
				gain: 0.1,
				attack: 0.04,
				decay: 0.42,
				notes: { done: [740, 740], confirm: [740, 740], error: [740, 740] }
			},
			bell: {
				label: "铃音（三角波、余音长）",
				osc: "triangle",
				gain: 0.24,
				attack: 0.01,
				decay: 0.7,
				notes: { done: [932, 932], confirm: [932, 932], error: [932, 932] }
			},
			alarm: {
				label: "醒目（三连音，怕错过用）",
				osc: "square",
				gain: 0.16,
				attack: 0.01,
				decay: 0.16,
				notes: { done: [900, 900, 900], confirm: [900, 900, 900], error: [900, 900, 900] }
			},
			minimal: {
				label: "极简（单声短促嘀）",
				osc: "sine",
				gain: 0.18,
				attack: 0.005,
				decay: 0.09,
				notes: { done: [988], confirm: [988], error: [988] }
			},
			wood: {
				label: "木质（短促、稍钝的双响）",
				osc: "triangle",
				gain: 0.2,
				attack: 0.005,
				decay: 0.2,
				notes: { done: [659, 659], confirm: [659, 659], error: [659, 659] }
			}
		};
		/** 音色偏好的存储键；刷新后据此恢复上次选择。 */
		const STYLE_STORAGE_KEY = "dsh-notify-sound.style";
		/** 默认音色（用户选定：木质）。 */
		const DEFAULT_SOUND_SET = "wood";
		/**
		 * 读取上次选择的音色。只有确实是已知音色才采用，
		 * 否则回退默认值（存储不可用时也回退）。
		 * @returns 音色键
		 */
		function readStoredStyle() {
			try {
				const saved = window.localStorage?.getItem(STYLE_STORAGE_KEY);
				if (saved !== null && saved !== undefined && SOUND_SETS[saved] !== undefined) return saved;
			} catch (error) {
				/* 隐私模式等场景下 localStorage 可能抛，忽略 */
			}
			return DEFAULT_SOUND_SET;
		}
		/** 记住当前音色；失败不影响运行。 */
		function writeStoredStyle(key) {
			try {
				window.localStorage?.setItem(STYLE_STORAGE_KEY, key);
			} catch (error) {
				/* 忽略 */
			}
		}
		/** 当前使用的音色键。没有界面可改，想换音色就改这里的值。 */
		let soundSetKey = DEFAULT_SOUND_SET;
		/** 取当前音色定义（容错：键失效时回退默认）。 */
		function currentSet() {
			return SOUND_SETS[soundSetKey] ?? SOUND_SETS[DEFAULT_SOUND_SET];
		}
		//#endregion

		//#region 通知中心
		/** 极简可订阅 store：React 半边用 useSyncExternalStore 消费。 */
		class NoticeStore {
			items = [];
			listeners = new Set();
			seq = 0;
			lastAt = 0;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			};
			getSnapshot = () => this.items;
			emit = () => {
				for (const listener of this.listeners) {
					try {
						listener();
					} catch (error) {
						console.warn("notify-sound: listener failed", error);
					}
				}
			};
			/**
			 * 推入一条通知；短时间内的同类型通知合并为计数。
			 * @param kind - done / confirm / error
			 * @param text - 可选补充说明
			 */
			push(kind, text) {
				const spec = KINDS[kind] ?? KINDS.done;
				const now = Date.now();
				const head = this.items[0];
				if (head !== undefined && head.kind === kind && now - head.at < 4000) {
					this.items = [{ ...head, count: head.count + 1, at: now, id: ++this.seq }, ...this.items.slice(1)];
					this.emit();
					return;
				}
				const item = { id: ++this.seq, kind, text: text ?? spec.detail, at: now, count: 1 };
				this.items = [item, ...this.items].slice(0, 4);
				this.emit();
				setTimeout(() => this.dismiss(item.id), NOTICE_TTL_MS);
			}
			/** 手动关闭一条。 */
			dismiss(id) {
				const next = this.items.filter((entry) => entry.id !== id);
				if (next.length === this.items.length) return;
				this.items = next;
				this.emit();
			}
			/** 全部关掉。 */
			clear() {
				if (this.items.length === 0) return;
				this.items = [];
				this.emit();
			}
			/** 是否允许现在响一声（节流）。 */
			allowSound() {
				const now = Date.now();
				if (now - this.lastAt < MIN_GAP_MS) return false;
				this.lastAt = now;
				return true;
			}
		}
		//#endregion

		//#region 提示音合成
		let audioContext;
		/** 取得（并按需恢复）AudioContext；不可用时返回 undefined。 */
		function ensureAudio() {
			try {
				const Ctor = window.AudioContext ?? window.webkitAudioContext;
				if (Ctor === undefined || Ctor === null) return undefined;
				audioContext ??= new Ctor();
				if (audioContext.state === "suspended") void audioContext.resume();
				return audioContext;
			} catch (error) {
				console.warn("notify-sound: audio unavailable", error);
				return undefined;
			}
		}
		/**
		 * 播放一次提示音。三种场景使用同一音型（同音双响）。
		 * @param _kind - 场景键（保留以便将来区分），当前不影响声音
		 * @param overrideKey - 可选的音色键（试听时用），缺省取当前音色
		 */
		function playChime(_kind, overrideKey) {
			const context = ensureAudio();
			if (context === undefined) return;
			const set = SOUND_SETS[overrideKey] ?? currentSet();
			// 统一音型：三种场景都一样，取任一项都得到同一个音符序列。
			const frequencies = set.notes.done ?? set.notes.confirm ?? set.notes.error ?? [880, 880];
			const start = context.currentTime + 0.01;
			const gap = Math.min(set.decay, 0.16);
			frequencies.forEach((frequency, index) => {
				const at = start + index * gap;
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				oscillator.type = set.osc;
				oscillator.frequency.setValueAtTime(frequency, at);
				gain.gain.setValueAtTime(0.0001, at);
				gain.gain.exponentialRampToValueAtTime(set.gain, at + set.attack);
				gain.gain.exponentialRampToValueAtTime(0.0001, at + set.attack + set.decay);
				oscillator.connect(gain).connect(context.destination);
				oscillator.start(at);
				oscillator.stop(at + set.attack + set.decay + 0.02);
			});
		}
		//#endregion

		//#region 界面
		/** 右上角浮层：显示未关闭的通知。 */
		function NotifyOverlay(props) {
			const items = react.useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
			// 提醒条必须贴在「视口」右上角。若挂载点的某个祖先带 transform / filter / perspective /
			// contain:paint，position:fixed 会改成相对那个祖先定位，提醒条就会跑到左侧栏上。
			// 每次渲染后量一次真实位置，用 transform 把偏差补回去，任何挂载点都能回到右上角。
			const stackRef = react.useRef(null);
			const pinToCorner = () => {
				const node = stackRef.current;
				if (node === null || node === undefined) return;
				try {
					// 迭代收敛：祖先若还带缩放，一次 translate 会差一个系数，量-补两三轮即可贴准。
					let tx = 0;
					let ty = 0;
					node.style.transform = "none";
					for (let i = 0; i < 3; i += 1) {
						const rect = node.getBoundingClientRect();
						if (rect.width === 0 && rect.height === 0) return;
						const dx = Math.round(window.innerWidth - 16 - rect.right);
						const dy = Math.round(56 - rect.top);
						if (dx === 0 && dy === 0) break;
						tx += dx;
						ty += dy;
						node.style.transform = `translate(${tx}px, ${ty}px)`;
					}
				} catch (error) {
					/* 量不到就保持原样式，不影响提醒本身 */
				}
			};
			(react.useLayoutEffect ?? react.useEffect)(() => { pinToCorner(); });
			react.useEffect(() => {
				const onResize = () => pinToCorner();
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, []);

			if (items.length === 0) return null;
			return react.createElement("div", { className: "dsh-notify-stack", ref: stackRef },
				items.map((item) => {
					const spec = KINDS[item.kind] ?? KINDS.done;
					return react.createElement("div", {
						key: item.id,
						className: "dsh-notify-card",
						style: { borderLeftColor: spec.color }
					},
						react.createElement("div", { className: "dsh-notify-head" },
							react.createElement("span", { className: "dsh-notify-dot", style: { background: spec.color } }),
							react.createElement("span", { className: "dsh-notify-title" },
								spec.label + (item.count > 1 ? ` ×${item.count}` : "")),
							react.createElement("button", {
								type: "button",
								className: "dsh-notify-close",
								title: "关闭",
								onClick: () => props.store.dismiss(item.id)
							}, "×")),
						react.createElement("div", { className: "dsh-notify-text" }, item.text));
				}),
				items.length > 1
					? react.createElement("button", {
						type: "button",
						className: "dsh-notify-clear",
						onClick: () => props.store.clear()
					}, "全部关闭")
					: null);
		}
		//#endregion

		//#region 会话状态跟踪
		/**
		 * 订阅 DSH 的 sessionStatus，把状态迁移翻译成通知。
		 * @param ctx - 客户端根上下文
		 * @param store - 通知中心
		 * @returns 停止订阅的函数
		 */
		function trackSessions(ctx, store) {
			const previous = new Map();
			let service;
			let stopped = false;
			const evaluate = () => {
				if (stopped || service === undefined) return;
				let snapshot;
				try {
					snapshot = service.getSnapshot();
				} catch (error) {
					return;
				}
				const entries = snapshot instanceof Map
					? snapshot.entries()
					: snapshot != null && typeof snapshot === "object"
						? Object.entries(snapshot)
						: [];
				for (const [sessionId, status] of entries) {
					if (status == null || typeof status !== "object") continue;
					const running = status.running === true;
					const pending = status.pendingInteraction !== undefined && status.pendingInteraction !== null;
					const before = previous.get(sessionId);
					previous.set(sessionId, { running, pending });
					if (before === undefined) continue; // 首次观测只做基线，不提醒
					let kind;
					if (pending && !before.pending) kind = "confirm";
					else if (before.running && !running && !pending) {
						kind = status.completionUnread === true && status.error === true ? "error" : "done";
					} else if (!pending && before.pending && !running && status.completionUnread === true) {
						kind = "done";
					}
					if (kind === undefined) continue;
					store.push(kind, KINDS[kind].detail);
					if (store.allowSound()) playChime(kind);
				}
			};
			/** 读取 ui-session 暴露的状态服务。 */
			const read = () => {
				try {
					const candidate = ctx.get("uiSession")?.sessionStatus;
					if (candidate !== undefined && typeof candidate.getSnapshot === "function" && typeof candidate.subscribe === "function") return candidate;
				} catch (error) {
					/* 服务未就绪时 ctx.get 会抛，交给下一轮重试 */
				}
				return undefined;
			};
			// ui-session 通常先于本插件激活，但顺序不保证：先直取，再轮询 15 秒。
			service = read();
			if (service !== undefined) {
				service.subscribe(evaluate);
				evaluate();
				return () => {
					stopped = true;
				};
			}
			const deadline = Date.now() + 15000;
			const timer = setInterval(() => {
				if (stopped) return clearInterval(timer);
				const found = read();
				if (found !== undefined) {
					clearInterval(timer);
					service = found;
					found.subscribe(evaluate);
					evaluate();
					return;
				}
				if (Date.now() > deadline) {
					clearInterval(timer);
					console.warn("notify-sound: uiSession.sessionStatus never became available; in-app notices stay idle");
				}
			}, 500);
			return () => {
				stopped = true;
				clearInterval(timer);
			};
		}
		//#endregion

		/** 插件激活前需要就绪的服务。 */
		const inject = ["sessions", "slots"];

		/** 样式只注入一次；类名都带插件前缀，不依赖宿主内部类名。 */
		function installStyles() {
			const id = "dsh-notify-sound/styles";
			if (document.getElementById(id) !== null) return;
			const style = document.createElement("style");
			style.id = id;
			style.textContent = `
.dsh-notify-stack{position:fixed;top:56px;right:16px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;max-width:min(340px,calc(100vw - 32px));pointer-events:none;font-size:13px}
.dsh-notify-card{box-sizing:border-box;pointer-events:auto;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-text-primary,#1f2328);border:1px solid var(--dsw-alias-border,rgba(0,0,0,.12));border-left-width:4px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px;animation:dsh-notify-in .18s ease-out}
.dsh-notify-head{display:flex;align-items:center;gap:6px}
.dsh-notify-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.dsh-notify-title{font-weight:600;flex:1 1 auto}
.dsh-notify-close{border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:15px;line-height:1;padding:0 2px}
.dsh-notify-close:hover{opacity:1}
.dsh-notify-text{margin-top:3px;opacity:.75;font-size:12px}
.dsh-notify-clear{align-self:flex-end;border:1px solid var(--dsw-alias-border,rgba(0,0,0,.15));background:transparent;color:inherit;opacity:.7;border-radius:8px;padding:3px 8px;cursor:pointer;font-size:12px}
@keyframes dsh-notify-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
`;
			document.head.appendChild(style);
		}

		/**
		 * 客户端插件主体：注册通知浮层与音色选择器，并跟踪会话状态。
		 * @param ctx - 客户端根上下文
		 */
		function apply(ctx) {
			const store = new NoticeStore();
			// 恢复上次选择的音色（默认木质）。
			try {
				soundSetKey = readStoredStyle();
			} catch (error) {
				/* 忽略：保留默认值 */
			}
			try {
				installStyles();
			} catch (error) {
				console.warn("notify-sound: cannot install styles", error);
			}
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "notify-sound"
				}, () => react.createElement(NotifyOverlay, { store })));
			} catch (error) {
				console.warn("notify-sound: shell.overlay slot unavailable", error);
			}
			let disposeTrack = () => {};
			try {
				disposeTrack = trackSessions(ctx, store) ?? (() => {});
			} catch (error) {
				console.warn("notify-sound: session tracking failed", error);
			}
			// 首次交互后解锁音频（浏览器要求用户手势后才能出声）。
			try {
				const unlock = () => {
					ensureAudio();
					window.removeEventListener("pointerdown", unlock);
					window.removeEventListener("keydown", unlock);
				};
				window.addEventListener("pointerdown", unlock, { once: true });
				window.addEventListener("keydown", unlock, { once: true });
			} catch (error) {
				/* 忽略 */
			}
			try {
				ctx.effect(() => () => disposeTrack(), "notify-sound: session status subscription");
			} catch (error) {
				/* 忽略：Cordis 版本差异 */
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

