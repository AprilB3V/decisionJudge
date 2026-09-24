# 0.3.0 上线评估证据

这些脚本使用隔离浏览器上下文和合成数据，不访问用户原有浏览器 profile。测试目标为 `pnpm build` 生成后由 `pnpm preview --host 127.0.0.1 --port 4173 --strictPort` 提供的站点。

## 文件

- `source-manifest.json`：评估时源码、构建配置与锁文件的 SHA-256，基于未提交工作区；不是一个可直接部署的 Git 提交。
- `build-manifest.json`：本轮 dist 构建产物 SHA-256。
- `smoke-release.cjs`：原有核心流程；本轮全部通过。
- `assistant-smoke-release.cjs`：普通/专业模式、助手模拟响应和数据保护；本轮全部通过；不调用真实 API。
- `release-probes.cjs` / `browser-probes.json`：删除确认/取消、版本冲突恢复和评分锚点的生产构建探针。本轮结果记录了删除保护已修复，R4/R5 仍保留当前行为。
- `replay-probe.test.ts.txt`：修复前跨日失败重放的历史探针，使用 fake-indexeddb；当前正确行为由 `src/infrastructure/localRepository.test.ts` 的回归用例覆盖。

## 重跑浏览器检查

在拥有 Playwright 的工具环境中执行。应用依赖未因评估增加 Playwright。设置 `PLAYWRIGHT_MODULE` 为现有 Playwright 模块的绝对目录，或让 Node 正常解析 `playwright`；默认使用已安装的 Edge。`BROWSER_CHANNEL` 可选，`RELEASE_URL` 默认为 `http://127.0.0.1:4173/`。

```powershell
$env:PLAYWRIGHT_MODULE = '你的 Playwright 模块绝对目录'
node docs/release-evidence/2026-09-24/smoke-release.cjs
node docs/release-evidence/2026-09-24/assistant-smoke-release.cjs
node docs/release-evidence/2026-09-24/release-probes.cjs
```

截图与合成备份输出到系统临时目录的 `decisionjudge-browser` 子目录。UI 修改后选择器可能需要随之维护。不要使用含真实私人数据的备份替换脚本夹具。

历史探针执行方法：如需复核修复前行为，可将 `.test.ts.txt` 复制到 `src/application/releaseProbe.test.ts`，运行 `pnpm exec vitest run src/application/releaseProbe.test.ts`，完成后删除临时副本。当前常规验收结果为 9 个文件 / 133 项，跨日重放回归已纳入 `localRepository.test.ts`。

本轮命令：`pnpm test`、`pnpm build`、`pnpm audit --json` 均退出 0。审计返回 info/low/moderate/high/critical 均为 0，totalDependencies=137。浏览器两套正常流程和修复后专项探针均退出 0；仓储回归测试覆盖跨日失败保存重放。
