# 拾阶 ORBIT · 英语备考工作台

[打开网站](https://doctor-zyx.github.io/english-exam-studio/) · [GitHub 仓库](https://github.com/Doctor-zyx/english-exam-studio) · [学习指南](dist/materials/公开版使用说明.md)

手机和电脑均可使用，浏览课程无需登录。以提供的教材与配套答案为依据，八个核心专题、103组教材练习按「分步理解 → 原题作答 → 反馈与复习」组织。浅色界面，每次只显示当前知识点的一个步骤或当前一道题。

当前有639个可作答项（152项自动核对、487项对照自评），另有7项因缺原材料而等待补充。103是题组数，不是考试题量。同一道原题的分类、改写等步骤可能拆成多个作答项。已提供的正文练习转为文字，包含原书已填写的编号示例；未提供的附录、评阅表单独标注，不计作已补齐。原PDF保留为查阅资料。

## 现在如何使用

1. 从「教材闯关」选择章节，在简洁总览中进入学习或练习。
2. 学习按「理解规则 → 拆解例句 → 试着判断」推进。中文讲解说明怎么做题；理解检查明确标为非教材原题。
3. 练习一次呈现一项，先提交再查看参考。客观题答错立即讲解，答对可自行展开；改写和作文提供参考及自评标准，不使用语义自动判分。
4. 草稿、学习位置、首次客观作答和重练结果分开保存。错题及手动复习重点可再次进入；重复练习不重复发放完成奖励。

界面改版保留原账号和已有记录。旧版整组完成标记不会替新增加的文字题认定完成；历史作答也不会冒充新版首次独立答对。

听力保留8个单元原音频与121个原题填空。645张词卡、2套自编模拟卷和126道自编自测题保留为辅助训练，不是新增的独立考试项目。考试范围、题量、分值以教师通知为准。

## 邮箱账号与进度

注册流程为：邮箱和密码 → 邮件验证码 → 网站验证并登录。以后使用邮箱和密码登录；找回密码入口采用邮箱验证码验证后设置新密码。

用户已确认真实注册、登录成功。账号同步沿用现有免费Supabase项目；本次界面与题库升级不要求重新配置邮件或数据库。密码恢复和真实手机/电脑双设备同步仍需单独实际验收，不能以注册成功代替。

游客记录只在当前浏览器，建议在账号页导出JSON备份。登录后等待同步成功，再到另一设备确认内容；游客进度需主动导入。不要在Git仓库中保存个人记录或凭据。

## 本地运行与发布

使用Node.js 24.15或更新的24.x；Node.js 22至少为22.22.2。

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run preview
```

通过终端给出的HTTP地址预览，不直接双击HTML。访客无需安装依赖。仓库使用GitHub Actions验证后发布`dist/`；失败不会部署。配置和验收细节见[部署.md](部署.md)。

## 教材维护

已核对文字保存在`tools/content/`，`sources.json`指定唯一组装来源；原题编号、题面、讲解和核对说明随分片保存。修改后执行：

```sh
python tools/assemble-textbooks.py
python tools/assemble-textbooks.py --verify-only
npm test
node scripts/check-public.mjs --require-cloud
```

组装器核验原题组ID和顺序；内容测试检查开放题标准、题面来源及答案提交前的隐藏。`tools/build-textbook-sentence.py --verify-only`另外核验Sentence原PDF和页图，需要本地原始资料及PDF依赖。不要直接修改原教材。

| 路径 | 用途 |
|---|---|
| `tools/content/`、`tools/assemble-textbooks.py` | 经核对的教材文字及可重复组装 |
| `dist/chapter.js`、`dist/chapter.css` | 独立学习、做题与反馈页面 |
| `dist/data/textbook-*.json`、`dist/textbook/` | 发布题库、原页及配套PDF |
| `dist/config.js`、`dist/cloud.js` | 公开连接配置、账号及进度同步 |
| `supabase/schema.sql`、`supabase/templates/` | 已部署数据库结构与验证码邮件模板 |
| `tests/`、`scripts/check-public.mjs` | 账号、交互、内容及公开资源检查 |
| `.github/workflows/deploy.yml` | Pages验证与发布 |

前端只保留项目URL和publishable key。SMTP授权码、数据库密码、服务密钥与管理令牌均不得提交到仓库。个人学习记录不随GitHub Pages发布。
