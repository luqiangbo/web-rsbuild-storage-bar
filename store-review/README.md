# StorageBar · Chrome Web Store 审核资料

规格与政策核对日期：2026-11-27（v2.0.0）。

## 上传素材

| Dashboard 字段 | 文件 | 规格 |
|---|---|---|
| 扩展图标 | [icon128.png](../public/icons/icon128.png) | 128×128 PNG，图形在中央 96×96 内，四边各留 16px 透明区 |
| 简体中文截图 | [工作台](images/zh-01-workspace-1280x800.png) · [JSON](images/zh-02-json-1280x800.png) · [Cookies](images/zh-03-cookies-1280x800.png) · [本地媒体](images/zh-04-media-1280x800.png) | 1280×800 RGB PNG |
| 英文截图 | [Workspace](images/en-01-workspace-1280x800.png) · [JSON](images/en-02-json-1280x800.png) · [Cookies](images/en-03-cookies-1280x800.png) · [Local Media](images/en-04-media-1280x800.png) | 1280×800 RGB PNG |
| 小宣传图 | [promo-small-440x280.png](images/promo-small-440x280.png) | 440×280 RGB PNG，可选 |
| 大宣传图 | [promo-marquee-1400x560.png](images/promo-marquee-1400x560.png) | 1400×560 RGB PNG，可选 |

商店要求提交图标和至少一张截图，每种语言最多五张截图。宣传图共用，无需按语言重复上传。截图取自 Chrome 中运行的扩展工作台，全部记录来自本地测试站点的虚构数据。 [图片要求](https://developer.chrome.com/docs/webstore/images) · [商店字段与本地化](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

扩展清单已登记 16、32、48、128 像素图标。重建发布产物后，确认清单和图标从 `public/` 进入 `dist/`。上传 ZIP 时让 `manifest.json` 位于压缩包根目录。商店文案和宣传素材在 Dashboard 上传。 [清单图标](https://developer.chrome.com/docs/extensions/reference/manifest/icons) · [发布流程](https://developer.chrome.com/docs/webstore/publish)

## Dashboard 文案

- **Store listing**：使用 [中英文商店介绍](LISTING.md)，分类可选 Developer Tools。
- **Privacy practices**：复制下面的用途和权限说明。将 [隐私政策](PRIVACY.md) 放到你控制的公开 HTTPS 页面，再填入 Dashboard 的隐私政策 URL。
- **Remote code**：确认最终提交包的运行时代码均随包分发后，选择 “No, I am not using remote code”。当前项目的站点注入逻辑来自扩展代码。
- **Data use**：按提交时表单的定义披露授权站点内容和浏览活动，以及可访问 Cookie 可能含有的认证信息。仅在本机处理仍需披露。StorageBar 为选择目标读取已打开网页的标题和地址。Cookie 导出数据可能含有登录会话信息。 Dashboard 声明、商店说明和隐私政策须保持一致。 [隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [用户数据说明](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

### Single purpose

> StorageBar lets developers and testers inspect and manage browser storage for the website tab they select. The side panel and workspace show website data in Chrome, and the media preview plays readable video files already stored locally by the selected website.

### Permission justifications

| 权限 | 可粘贴至 Dashboard 的英文说明 |
|---|---|
| `sidePanel` | Opens the StorageBar inspector beside the selected webpage so users can inspect and manage that page's storage in context. |
| `tabs` | Reads titles and URLs of open HTTP(S) tabs to populate the target selector and show the active target. Tab identity and navigation state are also used to keep operations tied to the selected page and to restore the target in the dedicated workspace. |
| `scripting` | Runs bundled storage-reading and management functions in the selected authorized top-level document. This is required for that tab's LocalStorage, SessionStorage, IndexedDB, Cache Storage and origin-private file previews. |
| `cookies` | Lists or modifies the target tab's accessible cookies when the user uses the Cookies tools. A local JSON backup can be exported or imported on request. |
| `clipboardWrite` | Copies the selected key, value, JSON path, URL or draft to the clipboard when the user presses Copy. |
| HTTP(S) host access | StorageBar inspects developer-selected tabs on any HTTP or HTTPS site. Chrome requests host access at installation so the inspector can open without a separate permission prompt on each site. The grant is used for the selected page's storage operations and Chrome's Cookie API. |

Google 会同时使用自动化和人工审核。较广的主机范围和敏感权限可能增加审查时间。准备好用独立测试站点说明目标选择、Cookie 本地备份和写操作范围。 [审核过程](https://developer.chrome.com/docs/webstore/review-process) · [开发者计划政策](https://developer.chrome.com/docs/webstore/program-policies/policies)

## Reviewer walkthrough

No account or credentials are required.

1. Accept Chrome's site access prompt when installing the extension. Open an ordinary HTTPS page such as `https://example.com/` and open StorageBar using the toolbar icon.
2. Select **Storage → LocalStorage** and add the key `storagebar_review_sample` with the value `{"project":"Review","enabled":true}`. Open the row and switch from **Raw** to **Tree**. Use the key search and copy a node or path.
3. Use **Open workspace in a new tab**. Confirm that the target stays on the original page while the workspace tab is active.
4. In **Cookies**, add a host-only cookie named `storagebar_review` with value `demo`. Export the site's accessible cookies to a local JSON file, then import the file and review the duplicate handling. Delete the temporary cookie and test key when done.
5. For local media, open an authorized test site that already stores a complete MP4 or WebM in OPFS, a video Blob/File in IndexedDB, or a readable response in Cache Storage. Choose **Local media**. The feature previews available local files up to 50 MiB.

Dashboard 的 Test instructions 是可选项，可把这段附在审核备注或支持文档。 [Google 测试说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)
