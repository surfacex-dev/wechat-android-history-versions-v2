/**
 * generatePages.js
 * 为每个微信 Android 版本生成独立目录页（versions/<version>/README.md），
 * 并把主 README 表格里的版本名改造成指向各目录的内链。
 *
 * 目的（SEO）：让“搜索某个具体版本号”时，仓库拥有独立可索引的 URL 与标题，
 * 版本号出现在 URL 路径、H1 标题、页内正文，提升长尾排名。
 *
 * 设计要点：
 *  - 按 version 聚合（同一版本的多个 APK 变体合并进同一目录，避免重复内容互相竞争）
 *  - 幂等：重复运行结果一致，已链接的行不会二次链接
 *  - 数据兜底：version 为空时，从 name 字段反推（如 “微信 6.6 for Android” -> 6.6）
 *  - 每页带真实差异化内容（发布日期、构建号、安装说明、官方 changelog 回链），规避薄内容
 *
 * 由 scripts/updateVersion.sh 在每小时 CI 中调用，保证新版本自动建目录。
 */
const fs = require('fs').promises;
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const versionFilePath = path.join(repoRoot, 'version.json');
const readmeFilePath = path.join(repoRoot, 'README.md');
const versionsDir = path.join(repoRoot, 'versions');

// 从 name 反推版本号，兜底处理 version 为空的脏数据
function resolveVersion(entry) {
    if (entry.version && String(entry.version).trim() !== '') {
        return String(entry.version).trim();
    }
    const m = (entry.name || '').match(/微信\s*([\d.]+)\s*for Android/i);
    return m ? m[1].trim() : '';
}

async function loadEntries() {
    const raw = await fs.readFile(versionFilePath, 'utf8');
    const data = JSON.parse(raw);
    const groups = new Map();
    for (const e of data) {
        const v = resolveVersion(e);
        if (!v) continue; // 彻底无法解析则跳过
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(e);
    }
    return groups;
}

// 按发布日期倒序（最新在前），日期缺失的排末尾
function sortVersions(groups) {
    return [...groups.keys()].sort((a, b) => {
        const da = (groups.get(a)[0].publish_date || '').replace(/[()]/g, '');
        const db = (groups.get(b)[0].publish_date || '').replace(/[()]/g, '');
        if (da === db) return b.localeCompare(a);
        return db.localeCompare(da);
    });
}

function buildVersionReadme(version, list) {
    const pub = (list[0].publish_date || '').replace(/[()]/g, '');
    const lines = [];
    lines.push(`# 微信 Android ${version} 历史版本下载（WeChat ${version} APK）`);
    lines.push('');
    lines.push(`> 微信（WeChat）Android **${version}** 官方历史版本安装包（APK）下载。所有下载链接均来自微信官网（dldir1v6.qq.com / dldir1.qq.com），点击即可直接下载，安全可信。`);
    lines.push('');
    lines.push('| 项目 | 内容 |');
    lines.push('| :--- | :--- |');
    lines.push(`| 版本号 | ${version} |`);
    lines.push(`| 发布日期 | ${pub || '未知'} |`);
    lines.push('| 平台 | Android |');
    lines.push('| 包类型 | APK |');
    lines.push('| 官方更新日志 | [weixin.qq.com/updates](https://weixin.qq.com/updates) |');
    lines.push('');
    lines.push('## 下载地址');
    lines.push('');
    lines.push(`以下是微信 Android ${version} 的所有官方安装包（直接来自微信官网）：`);
    lines.push('');
    for (const item of list) {
        const fname = item.url.split('/').pop();
        lines.push(`- [${fname}](${item.url})`);
    }
    lines.push('');
    lines.push('## 安装说明');
    lines.push('');
    lines.push('1. 在手机浏览器中打开本页面，点击上方链接将 APK 保存到本机。');
    lines.push('2. 安装前请在「设置 → 安全」中允许「未知来源」应用安装。');
    lines.push('3. 若系统提示签名冲突，请先卸载现有微信再安装本历史版本（会清空本地聊天记录，请提前备份）。');
    lines.push('');
    lines.push('## 相关资源');
    lines.push('');
    lines.push('- 返回 [微信 Android 历史版本总目录](../../)');
    lines.push('- 微信官方更新日志：[weixin.qq.com/updates](https://weixin.qq.com/updates)');
    lines.push('');
    return lines.join('\n');
}

// 把主 README 中“| 微信 X for Android  |”的版本名改造成指向 versions/X/ 的内链（幂等）
async function linkifyReadme() {
    let content = await fs.readFile(readmeFilePath, 'utf8');
    const re = /\| 微信 ([\d.]+) for Android  \|/g;
    content = content.replace(re, (_m, v) => `| [微信 ${v} for Android](versions/${v}/)  |`);
    await fs.writeFile(readmeFilePath, content, 'utf8');
}

async function main() {
    const groups = await loadEntries();
    const versions = sortVersions(groups);
    await fs.mkdir(versionsDir, { recursive: true });

    let created = 0;
    for (const v of versions) {
        const dir = path.join(versionsDir, v);
        await fs.mkdir(dir, { recursive: true });
        const md = buildVersionReadme(v, groups.get(v));
        await fs.writeFile(path.join(dir, 'README.md'), md, 'utf8');
        created++;
    }

    await linkifyReadme();
    console.log(`生成/更新了 ${created} 个版本目录（versions/<version>/README.md），并已把主 README 版本名内链化。`);
}

main().catch((err) => {
    console.error('生成失败:', err);
    process.exit(1);
});
