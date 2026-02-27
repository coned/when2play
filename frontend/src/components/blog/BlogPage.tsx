import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import blogMd from '../../../../blog/blog.md?raw';

// Import all blog images as URLs via Vite — keys are glob paths, values are hashed asset URLs
const blogAssets = import.meta.glob<string>(
	'../../../../blog/assets/*.{png,jpg,gif,svg,webp}',
	{ eager: true, query: '?url', import: 'default' },
);

// Build filename → URL map: "handshake.png" → "/assets/handshake-abc123.png"
const imageMap = new Map<string, string>();
for (const [path, url] of Object.entries(blogAssets)) {
	const filename = path.split('/').pop()!;
	imageMap.set(filename, url);
}

export function BlogPage() {
	const html = useMemo(() => {
		// Rewrite relative image paths to Vite-processed URLs
		const processed = blogMd.replace(
			/!\[([^\]]*)\]\(assets\/([^)]+)\)/g,
			(_, alt, filename) => {
				const url = imageMap.get(filename);
				return url ? `![${alt}](${url})` : `![${alt}](assets/${filename})`;
			},
		);
		marked.setOptions({ breaks: false, gfm: true });
		return marked.parse(processed) as string;
	}, []);

	return (
		<div style={{ maxWidth: '900px', margin: '0 auto' }}>
			<h2 style={{ marginBottom: '4px' }}>Blog</h2>
			<p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '28px' }}>Thoughts on gaming coordination</p>
			<div class="blog-content" dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	);
}
