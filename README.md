# 拾阶 ORBIT · 英语备考工作台

[打开网站](https://doctor-zyx.github.io/english-exam-studio/) · [GitHub 仓库](https://github.com/Doctor-zyx/english-exam-studio) · [学习指南](dist/materials/公开版使用说明.md)

手机和电脑均可使用，浏览课程无需登录。主线是「分步学习 → 教材原题 → 反馈与复习」：8个专题、103组教材原题关卡，另有原始听力、错题和学习记录。

103组是题组数，不是小题数。41项已核对客观小题支持自动反馈；其中部分题组只转录了部分小题，整组仍需完成原页作答并自评。645张词卡、2套自编模拟卷和126道自编自测题属于辅助训练，不是新增的独立考试项目。

## 现在如何使用

1. 打开网站，从「教材闯关」选择 Sentence skills 或薄弱专题，逐点学习。
2. 进入独立的原题入口，阅读原页并作答。开放题、改写和作文对照原答案自评。
3. 游客记录保存在当前浏览器；定期在账号页导出 JSON。账号登录尚未启用时，游客模式仍可用。

原扫描页可能带已有批注或示范答案；缺失的附录、无固定答案的任务均有说明。具体考试题量、分值和范围以教师通知为准。

## 账号服务还差一次设置

Supabase 免费项目 **english-exam-studio** 已在 **Yingyu** 组织创建，数据库与权限已部署。GitHub 登录还需要项目所有者创建 OAuth App，并把凭据填入 Supabase。按 [部署步骤](部署.md) 操作即可，**不需要再建项目或重复迁移**。

设置完成后，电脑和手机使用同一个 GitHub 账号登录，并确认同步成功，才能使用云端学习记录。登录提供方未开启或无法确认时，页面会提示并保留游客入口。本站不要求学习者拥有 Supabase 账号。

截至2026-10-25：真实数据库的隔离与版本冲突 SQL 测试已通过，临时测试数据已回滚；安全和性能 Advisor 均无提示。本轮53项自动测试全部通过；公开检查核对278个文件、103组题组、41个客观小题，零错误、零警告。已实测GitHub提供方尚未开启，真实授权、手机登录及跨设备同步仍待OAuth设置后验证。自动测试使用模拟后端和jsdom，不代表真实浏览器全流程验收。

## 本地运行与发布

使用 Node.js 24.15 或更新的24.x；Node.js 22至少为22.22.2。

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run preview
```

打开终端显示的地址，通过 HTTP 加载网页，不直接双击 `dist/index.html`。npm 依赖仅用于开发测试，访客不用安装。仅预览时可直接运行 `npm run preview`。

仓库 Pages 发布来源使用 **GitHub Actions**。推送 `main` 后，工作流安装锁定依赖、执行测试和资源检查，再发布 `dist/`；失败不会部署。配置与验收细节见 [部署.md](部署.md)。

## 维护入口

| 路径 | 用途 |
|---|---|
| `dist/data/textbook-*.json`、`dist/textbook/` | 原题索引、原页与配套PDF |
| `dist/config.js`、`dist/cloud.js` | 前端公开连接配置、账号及进度同步 |
| `supabase/schema.sql` | 已部署数据库结构、RLS、版本比较更新函数 |
| `tests/`、`package-lock.json` | 自动测试及锁定开发依赖 |
| `scripts/check-public.mjs` | 公开资源、敏感内容和题库关系检查 |
| `.github/workflows/deploy.yml` | Pages 验证与发布流程 |

前端仅保留项目 URL 和 publishable key。GitHub Client secret、数据库密码、服务密钥和管理令牌均不能提交到仓库。个人学习记录不随 GitHub Pages 发布。
