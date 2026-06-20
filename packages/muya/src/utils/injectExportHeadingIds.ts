import { generateGithubSlug } from './slug';

/** 为导出标题注入 GitHub 兼容的 slug `id`，供 TOC 锚点跳转。 */
export function injectExportHeadingIds(container: HTMLElement): void {
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const seen = new Set<string>();

    for (const heading of headings) {
        if (heading.id)
            seen.add(heading.id);
    }

    for (const heading of headings) {
        if (heading.id)
            continue;

        const base = generateGithubSlug(heading.textContent ?? '') || 'heading';
        let slug = base;
        let n = 1;
        while (seen.has(slug))
            slug = `${base}-${n++}`;

        seen.add(slug);
        heading.id = slug;
    }
}
