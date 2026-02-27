import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import blogMd from '../../../../blog/blog.md?raw';

export function BlogPage() {
	const html = useMemo(() => {
		marked.setOptions({ breaks: false, gfm: true });
		return marked.parse(blogMd) as string;
	}, []);

	return (
		<div style={{ maxWidth: '680px' }}>
			<h2 style={{ marginBottom: '4px' }}>Blog</h2>
			<p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '28px' }}>Thoughts on gaming coordination</p>
			<div class="blog-content" dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	);
}
