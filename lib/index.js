/**
 * dsh-notify-sound —— 宿主半边（空壳）。
 *
 * 这个插件全部行为都在浏览器半边（exports "./client"）。宿主侧只需要一个
 * 可被 Loader 挂载的 apply，让 cordis.patch.yml 里那一行有主，Web 客户端
 * 模块系统才会扫描到 package.json 的 dsh.client 声明并加载浏览器 bundle。
 */

/** Stable cordis plugin identity; matches the insert id in cordis.patch.yml. */
const name = 'notify-sound'

/** Host half performs no runtime work. */
function apply() {}

export { apply, name }
