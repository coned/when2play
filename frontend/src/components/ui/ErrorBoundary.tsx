import { Component, type ComponentChildren } from 'preact';

interface ErrorBoundaryProps {
	children: ComponentChildren;
	/** "tab" keeps the app around it (header and navigation); "app" fills the page. */
	scope: 'tab' | 'app';
}

interface ErrorBoundaryState {
	error: unknown;
}

/**
 * Catches an error thrown while rendering its children and shows a readable message
 * with a Reload button instead of a blank page. A tab-level boundary is keyed by the
 * tab in Home, so switching tabs mounts a fresh one and the error is gone.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
		return { error: error ?? new Error('Unknown error') };
	}

	componentDidCatch(error: unknown) {
		console.error(`[ErrorBoundary:${this.props.scope}]`, error);
	}

	render() {
		if (!this.state.error) return this.props.children;
		const isTab = this.props.scope === 'tab';
		return (
			<div
				style={{
					display: 'flex',
					justifyContent: 'center',
					alignItems: isTab ? 'flex-start' : 'center',
					padding: isTab ? '24px 0' : '16px',
					height: isTab ? undefined : '100%',
				}}
			>
				<div role="alert" class="card" style={{ padding: '20px 24px', maxWidth: '440px', textAlign: 'center' }}>
					<p style={{ color: 'var(--danger)', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Something went wrong</p>
					<p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
						{isTab
							? 'This page could not be shown. Try another tab, or reload the app.'
							: 'when2play hit an unexpected error. Reloading usually fixes it.'}
					</p>
					<button class="btn btn-primary" type="button" onClick={() => window.location.reload()}>
						Reload
					</button>
				</div>
			</div>
		);
	}
}
