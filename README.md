# 藏酿 · 私人酒窖 GitHub Pages 演示版

这个目录是从私人酒窖原工程单独提取的公开演示版。GitHub Pages 只提供静态网站，因此本版使用浏览器 IndexedDB 保存出入库、寄存、档案和流水。数据仅在当前浏览器保留，不与其他设备同步，也不连接原 Sites D1 数据库。

初始模拟数据：26 款酒、260 瓶、276 条逐瓶流转记录。页面、图片和业务表单沿用原工程；原服务端源码和私有数据库均不发布到这个仓库。

## 本机运行

```bash
npm ci
npm run dev
```

## 验证与构建

```bash
npm test
npm run build
```

推送到 GitHub 的 `main` 分支后，工作流会将 `dist/` 发布到 GitHub Pages。仓库 Settings → Pages 的 Build and deployment 需选 GitHub Actions。
