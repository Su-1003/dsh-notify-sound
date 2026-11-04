window.__ModuleLoader__.load({
	id: "dsh-notify-sound",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");

		//#region 通知类型
		/**
		 * 三种提醒场景。声音统一（同一音型），
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
		/** 三种场景共用同一串音符（按用户要求：声音上不区分场景）。 */
		function sameTone(frequencies) {
			return { done: frequencies, confirm: frequencies, error: frequencies };
		}
		/**
		 * 可选音色。每种定义波形、包络、音符序列，可选 glide（滑音倍数）。
		 *
		 * 音符间隔 = min(decay, 0.16)：想让三连音更挤就调小 decay。
		 * glide 表示「这一声从 f 滑到 f×glide」，用来做水滴、泡泡那类音。
		 */
		const SOUND_SETS = {
			wood: {
				label: "木质",
				desc: "短促、稍钝的双响，最不打扰（默认）",
				osc: "triangle",
				gain: 0.2,
				attack: 0.005,
				decay: 0.2,
				notes: sameTone([659, 659])
			},
			clean: {
				label: "清脆",
				desc: "明亮干净的双响，一耳朵就能听见",
				osc: "sine",
				gain: 0.22,
				attack: 0.02,
				decay: 0.28,
				notes: sameTone([880, 880])
			},
			soft: {
				label: "柔和",
				desc: "音量减半、余音稍长，夜里不刺耳",
				osc: "sine",
				gain: 0.1,
				attack: 0.04,
				decay: 0.42,
				notes: sameTone([740, 740])
			},
			bell: {
				label: "铃音",
				desc: "三角波、余音长，像小铃铛",
				osc: "triangle",
				gain: 0.24,
				attack: 0.01,
				decay: 0.7,
				notes: sameTone([932, 932])
			},
			alarm: {
				label: "醒目",
				desc: "方波三连音，怕错过就用它",
				osc: "square",
				gain: 0.16,
				attack: 0.01,
				decay: 0.16,
				notes: sameTone([900, 900, 900])
			},
			minimal: {
				label: "极简",
				desc: "单声短促「嘀」，几乎不占注意力",
				osc: "sine",
				gain: 0.18,
				attack: 0.005,
				decay: 0.09,
				notes: sameTone([988])
			},
			chime: {
				label: "三音上行",
				desc: "叮—咚—叮，往上走的三个音，听着像「好了」",
				osc: "sine",
				gain: 0.2,
				attack: 0.008,
				decay: 0.26,
				notes: sameTone([784, 988, 1175])
			},
			marimba: {
				label: "木琴",
				desc: "连续三下木琴，带点颗粒感",
				osc: "triangle",
				gain: 0.2,
				attack: 0.004,
				decay: 0.3,
				notes: sameTone([523, 659, 784])
			},
			drop: {
				label: "水滴",
				desc: "一声往上滑的水滴，短、轻、有弹性",
				osc: "sine",
				gain: 0.18,
				attack: 0.006,
				decay: 0.26,
				glide: 1.9,
				notes: sameTone([620])
			},
			down: {
				label: "双音下行",
				desc: "两个音往下掉，像「结束」",
				osc: "sine",
				gain: 0.22,
				attack: 0.01,
				decay: 0.24,
				notes: sameTone([988, 740])
			},
			deep: {
				label: "低频咚",
				desc: "很低的一声，穿透力强但不吵，隔耳机也听得见",
				osc: "sine",
				gain: 0.34,
				attack: 0.01,
				decay: 0.46,
				notes: sameTone([196])
			},
			tick: {
				label: "轻嗒",
				desc: "极高极轻的一下，只够你注意到",
				osc: "sine",
				gain: 0.09,
				attack: 0.002,
				decay: 0.06,
				notes: sameTone([1568])
			}
		};
		const STYLE_KEY = "dsh-notify-sound.style";
		const SOUND_KEY = "dsh-notify-sound.sound";
		const BANNER_KEY = "dsh-notify-sound.banner";
		/** 默认音色（用户选定：木质）。 */
		const DEFAULT_SOUND_SET = "wood";
		//#endregion

		//#region 偏好
		/**
		 * 插件自己的偏好：音色 + 声音开关 + 通知条开关。
		 * 存 localStorage，存不了（隐私模式等）就只在本次会话有效。
		 * 提供 getSnapshot / subscribe，界面上用 useSyncExternalStore 消费。
		 */
		class PrefsStore {
			listeners = new Set();
			state = { style: DEFAULT_SOUND_SET, sound: true, banner: true };
			constructor() {
				this.state = this.load();
			}
			load() {
				let style = DEFAULT_SOUND_SET;
				let sound = true;
				let banner = true;
				try {
					const savedStyle = window.localStorage?.getItem(STYLE_KEY);
					if (savedStyle !== null && savedStyle !== undefined && SOUND_SETS[savedStyle] !== undefined) style = savedStyle;
					sound = window.localStorage?.getItem(SOUND_KEY) !== "off";
					banner = window.localStorage?.getItem(BANNER_KEY) !== "off";
				} catch (error) {
					/* 存储不可用时保留默认值 */
				}
				return { style, sound, banner };
			}
			save(patch) {
				try {
					if (patch.style !== undefined) window.localStorage?.setItem(STYLE_KEY, patch.style);
					if (patch.sound !== undefined) window.localStorage?.setItem(SOUND_KEY, patch.sound ? "on" : "off");
					if (patch.banner !== undefined) window.localStorage?.setItem(BANNER_KEY, patch.banner ? "on" : "off");
				} catch (error) {
					/* 忽略 */
				}
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			};
			getSnapshot = () => this.state;
			/** 合并更新：只接受合法音色；没有实际变化时不通知。 */
			update = (patch) => {
				const next = { ...this.state, ...patch };
				if (SOUND_SETS[next.style] === undefined) next.style = DEFAULT_SOUND_SET;
				if (next.style === this.state.style && next.sound === this.state.sound && next.banner === this.state.banner) return;
				this.state = next;
				this.save(patch);
				for (const listener of this.listeners) {
					try {
						listener();
					} catch (error) {
						console.warn("notify-sound: prefs listener failed", error);
					}
				}
			};
		}
		const prefs = new PrefsStore();
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
		 * 播放一次提示音。
		 * @param overrideKey - 可选的音色键（试听时用），缺省取偏好里的音色
		 */
		function playChime(overrideKey) {
			const context = ensureAudio();
			if (context === undefined) return;
			const key = overrideKey ?? prefs.getSnapshot().style;
			const set = SOUND_SETS[key] ?? SOUND_SETS[DEFAULT_SOUND_SET];
			// 三种场景共用同一串音符，取任一项都相同。
			const frequencies = set.notes.done ?? set.notes.confirm ?? set.notes.error ?? [880, 880];
			const start = context.currentTime + 0.01;
			const gap = Math.min(set.decay, 0.16);
			const glide = typeof set.glide === "number" && set.glide > 0 ? set.glide : undefined;
			frequencies.forEach((frequency, index) => {
				const at = start + index * gap;
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				oscillator.type = set.osc;
				oscillator.frequency.setValueAtTime(frequency, at);
				if (glide !== undefined) oscillator.frequency.exponentialRampToValueAtTime(frequency * glide, at + set.attack + set.decay);
				gain.gain.setValueAtTime(0.0001, at);
				gain.gain.exponentialRampToValueAtTime(set.gain, at + set.attack);
				gain.gain.exponentialRampToValueAtTime(0.0001, at + set.attack + set.decay);
				oscillator.connect(gain).connect(context.destination);
				oscillator.start(at);
				oscillator.stop(at + set.attack + set.decay + 0.02);
			});
		}
		//#endregion

		//#region 界面：右上角通知条
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

		//#region 界面：设置页
		/**
		 * 设置 → 通知提示音：换音色、试听、关声音 / 关通知条。
		 * 数据全在 localStorage，不经过宿主设置文档，改完立刻生效。
		 */
		function SettingsPanel(props) {
			const preferences = props.prefs;
			const state = react.useSyncExternalStore(preferences.subscribe, preferences.getSnapshot);
			const entries = Object.entries(SOUND_SETS);

			const switchEl = (key, on, title) => react.createElement("button", {
				type: "button",
				className: "dsh-ns-switch" + (on ? " is-on" : ""),
				role: "switch",
				"aria-checked": on,
				"aria-label": title,
				onClick: () => preferences.update({ [key]: !on })
			}, react.createElement("span", { className: "dsh-ns-knob" }));

			const toggleRow = (title, sub, key) => react.createElement("div", { className: "dsh-ns-row" },
				react.createElement("span", { className: "dsh-ns-label" }, title,
					react.createElement("span", { className: "dsh-ns-sub" }, sub)),
				switchEl(key, state[key], title));

			const pickRow = ([key, set]) => {
				const selected = state.style === key;
				return react.createElement("div", {
					key,
					className: "dsh-ns-row dsh-ns-pick" + (selected ? " is-on" : ""),
					role: "button",
					tabIndex: 0,
					"aria-pressed": selected,
					onClick: () => preferences.update({ style: key }),
					onKeyDown: (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						preferences.update({ style: key });
					}
				},
					react.createElement("span", { className: "dsh-ns-dot" }),
					react.createElement("span", { className: "dsh-ns-label" }, set.label,
						react.createElement("span", { className: "dsh-ns-sub" }, set.desc)),
					react.createElement("button", {
						type: "button",
						className: "dsh-ns-preview",
						onClick: (event) => {
							event.stopPropagation();
							playChime(key);
						}
					}, "试听"));
			};

			return react.createElement("div", { className: "dsh-ns" },
				react.createElement("div", null,
					react.createElement("h2", { className: "dsh-ns-title" }, "通知提示音"),
					react.createElement("p", { className: "dsh-ns-desc" },
						"任务完成、需要你确认、出错中断时，右上角弹一条通知并播放提示音。声音由浏览器实时合成，不读音频文件。偏好存在本机，改完立刻生效。")),
				react.createElement("div", { className: "dsh-ns-group" },
					toggleRow("提示音", "关掉之后只弹通知条，不出声", "sound"),
					toggleRow("通知条", "关掉之后既不弹条也不出声", "banner")),
				react.createElement("div", null,
					react.createElement("div", { className: "dsh-ns-caption" }, "音色"),
					react.createElement("div", { className: "dsh-ns-group" }, entries.map(pickRow))),
				react.createElement("div", { className: "dsh-ns-foot" },
					react.createElement("button", {
						type: "button",
						className: "dsh-ns-btn",
						onClick: () => {
							props.notices.push("done", "这是一条测试通知：声音和通知条都正常。");
							playChime();
						}
					}, "发送测试通知"),
					react.createElement("button", {
						type: "button",
						className: "dsh-ns-btn",
						onClick: () => preferences.update({ style: DEFAULT_SOUND_SET, sound: true, banner: true })
					}, "恢复默认"),
					react.createElement("span", { className: "dsh-ns-hint" }, "三种场景声音相同，只有通知条的文字和颜色不同。")));
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
					const current = prefs.getSnapshot();
					if (current.banner) store.push(kind, KINDS[kind].detail);
					if (current.sound && store.allowSound()) playChime();
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

		/** 全部样式文本（类名都带插件前缀，不依赖宿主内部类名）。 */
		const STYLE_TEXT = `
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
.dsh-ns{display:flex;flex-direction:column;gap:16px;max-width:620px;padding:2px;font-size:13px;line-height:1.5;color:var(--dsw-alias-text-primary,#1f2328)}
.dsh-ns-title{font-size:15px;font-weight:600;margin:0}
.dsh-ns-desc{margin:6px 0 0;opacity:.62;font-size:12px}
.dsh-ns-caption{margin:0 0 6px;opacity:.55;font-size:12px}
.dsh-ns-group{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border,rgba(0,0,0,.12));border-radius:10px;overflow:hidden}
.dsh-ns-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:0;border-bottom:1px solid var(--dsw-alias-border,rgba(0,0,0,.08));background:transparent;color:inherit;font:inherit;text-align:left;width:100%;box-sizing:border-box}
.dsh-ns-row:last-child{border-bottom:0}
.dsh-ns-label{flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-ns-sub{opacity:.6;font-size:12px}
.dsh-ns-pick{cursor:pointer;outline:none}
.dsh-ns-pick:hover{background:var(--dsw-alias-bg-hover,rgba(127,127,127,.10))}
.dsh-ns-pick:focus-visible{box-shadow:inset 0 0 0 1px var(--dsw-alias-accent,#2f81f7)}
.dsh-ns-dot{width:14px;height:14px;border-radius:50%;border:1px solid var(--dsw-alias-border,rgba(0,0,0,.3));flex:0 0 auto;box-sizing:border-box;transition:box-shadow .12s}
.dsh-ns-pick.is-on .dsh-ns-dot{border-color:var(--dsw-alias-accent,#2f81f7);box-shadow:inset 0 0 0 3px var(--dsw-alias-accent,#2f81f7)}
.dsh-ns-preview{border:1px solid var(--dsw-alias-border,rgba(0,0,0,.15));background:transparent;color:inherit;border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;opacity:.85;flex:0 0 auto}
.dsh-ns-preview:hover{opacity:1;background:rgba(127,127,127,.12)}
.dsh-ns-switch{width:38px;height:22px;border-radius:11px;border:1px solid var(--dsw-alias-border,rgba(0,0,0,.18));background:rgba(127,127,127,.28);position:relative;cursor:pointer;padding:0;flex:0 0 auto;transition:background .15s}
.dsh-ns-switch.is-on{background:var(--dsw-alias-accent,#2f81f7);border-color:transparent}
.dsh-ns-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.dsh-ns-switch.is-on .dsh-ns-knob{transform:translateX(16px)}
.dsh-ns-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dsh-ns-btn{border:1px solid var(--dsw-alias-border,rgba(0,0,0,.15));background:transparent;color:inherit;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer}
.dsh-ns-btn:hover{background:rgba(127,127,127,.12)}
.dsh-ns-hint{opacity:.5;font-size:12px}
`;
		/**
		 * 注入样式。热更新时上一个实例留下的 <style> 还留在 head 里，
		 * 所以不能「已存在就直接 return」——那样新加的 .dsh-ns-* 规则一条都进不了 DOM。
		 * 改为按内容比对后覆盖。
		 */
		function installStyles() {
			const id = "dsh-notify-sound/styles";
			let style = document.getElementById(id);
			if (style === null) {
				style = document.createElement("style");
				style.id = id;
				document.head.appendChild(style);
			}
			if (style.textContent !== STYLE_TEXT) style.textContent = STYLE_TEXT;
		}

		/**
		 * 客户端插件主体：注册通知浮层、设置页与音色选择，并跟踪会话状态。
		 * @param ctx - 客户端根上下文
		 */
		function apply(ctx) {
			const notices = new NoticeStore();
			try {
				installStyles();
			} catch (error) {
				console.warn("notify-sound: cannot install styles", error);
			}
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "notify-sound"
				}, () => react.createElement(NotifyOverlay, { store: notices })));
			} catch (error) {
				console.warn("notify-sound: shell.overlay slot unavailable", error);
			}
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "notify-sound",
					order: 60,
					label: () => "通知提示音"
				}, () => react.createElement(SettingsPanel, { prefs, notices })));
			} catch (error) {
				console.warn("notify-sound: settings.section slot unavailable", error);
			}
			let disposeTrack = () => {};
			try {
				disposeTrack = trackSessions(ctx, notices) ?? (() => {});
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
