# 拾阶英语 · 公开版备考工作台

手机与电脑共用的英语考试备考网页：课程听力、写作讲义、词卡、模拟卷、错题与复习计划。网站由 GitHub Pages 公开托管，浏览课程无需第三方平台账号；启用 Supabase 后，可用本站邮箱账号同步个人进度。

网站：[打开拾阶英语](https://doctor-zyx.github.io/english-exam-studio/) · 仓库：[Doctor-zyx/english-exam-studio](https://github.com/Doctor-zyx/english-exam-studio)

账号云同步目前待接通：`dist/config.js` 尚未填写 Supabase 连接配置，可先以游客模式学习。网站首次访问需等待 GitHub Actions 部署成功。

## 本地运行

建议使用 Node.js 24.15 或更新的 24.x；使用 Node.js 22 时至少为 22.22.2，以满足当前锁定的 jsdom 测试依赖。

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run preview
```

`npm ci` 按 `package-lock.json` 安装开发测试依赖，`--ignore-scripts` 禁止安装阶段运行依赖生命周期脚本。网页仍是静态文件；浏览用户无需安装 Node.js 或 npm。仅预览已有网页时可直接运行 `npm run preview`，但提交前需完成上述测试和检查。

打开终端显示的地址。不要直接双击 `dist/index.html`，浏览器需要通过 HTTP 加载题库。`npm test` 运行同步逻辑及 jsdom 界面交互测试，不代表真实 Supabase 权限、邮件或所有手机浏览器已验收。

## 发布到 GitHub Pages

1. 把**本目录内容**放在一个 GitHub 仓库根目录，使用 `main` 分支。
2. 在仓库 `Settings → Pages → Build and deployment` 中选择 **GitHub Actions**。
3. 推送 `main` 后，`Validate and deploy GitHub Pages` 工作流安装锁定的测试依赖、运行测试与公开资源检查，再上传 `dist/` 并部署。也可在 Actions 中手动运行。
4. 从成功部署任务的 `github-pages` 环境打开实际网址。资源使用相对路径，兼容 `https://<用户名>.github.io/<仓库名>/`。

部署工作流只发布静态目录；个人作答不提交到 Git。工作流版本与权限依据 [GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 启用账号与云同步

1. 新建 Supabase 项目，在 SQL Editor 执行 [`supabase/schema.sql`](supabase/schema.sql)。
2. 开启 Email／Password 注册登录，保留邮箱确认，配置邮件发送服务。
3. 将 GitHub Pages 完整网址（包含仓库路径和结尾 `/`）设为 Site URL，并将该网址及找回密码回调加入 Redirect URLs。
4. 修改 [`dist/config.js`](dist/config.js)，填写项目 URL 与 **publishable key**。
5. 推送更新，按 [`部署.md`](部署.md) 完成两账号隔离、跨设备和冲突验证。

配置未填写时，账号和云同步不会连接到真实后端；课程仍可作为本地学习工具使用。前端公开配置不是服务端密钥：不得使用 `sb_secret_…`、`service_role`、数据库密码或管理令牌。个人进度依赖数据库 RLS 按用户隔离。参见 [Supabase 密钥说明](https://supabase.com/docs/guides/getting-started/api-keys) 与 [RLS 官方文档](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 项目结构

| 路径 | 用途 |
|---|---|
| `dist/` | 实际公开发布的网页、课程数据、音频与讲义 |
| `dist/config.js` | 公开的 Supabase 连接配置 |
| `dist/cloud.js` | 邮箱登录与个人进度同步 |
| `supabase/schema.sql` | 数据表、RLS 与版本条件更新函数 |
| `scripts/check-public.mjs` | 发布目录、敏感内容、资源与题库检查 |
| `tests/`、`package-lock.json` | 同步与界面测试，以及可复现的开发依赖版本 |
| `.github/workflows/deploy.yml` | GitHub Actions Pages 部署 |

教材整理与模拟卷用于备考训练；正式考试范围、分值和题型以教师通知为准。共享课程内容与个人学习记录分开：前者公开，后者在启用并验证 Supabase 权限后仅由相应账号访问。
