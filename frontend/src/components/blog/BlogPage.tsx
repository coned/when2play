const codeStyle: Record<string, string> = {
	background: 'var(--bg-tertiary)',
	padding: '12px 16px',
	borderRadius: '6px',
	fontSize: '13px',
	fontFamily: 'monospace',
	overflowX: 'auto',
	whiteSpace: 'pre',
	lineHeight: '1.5',
	color: 'var(--text-secondary)',
	margin: '12px 0',
};

const sectionStyle: Record<string, string> = {
	marginBottom: '28px',
};

export function BlogPage() {
	return (
		<div style={{ maxWidth: '680px' }}>
			<h2 style={{ marginBottom: '4px' }}>Blog</h2>
			<p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '28px' }}>Thoughts on gaming coordination</p>

			<article>
				<h3 style={{ marginBottom: '8px', color: 'var(--accent)' }}>
					The Gaming Tree: When Scheduling Feels Like a TCP Handshake
				</h3>
				<p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
					February 2026
				</p>

				<div style={sectionStyle}>
					<h4 style={{ marginBottom: '8px' }}>The Problem</h4>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)' }}>
						If you've ever tried to get 4-5 friends online at the same time, you know the drill.
						Someone drops a "play tonight?" in Discord at 2 PM. Three hours pass. Someone says
						"maybe." Two more hours. Another person says "I'm in after dinner." By 9 PM you've got
						three people ready, one who went AFK, and one who forgot they said yes.
					</p>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)', marginTop: '8px' }}>
						This is a coordination problem, and it turns out it looks a lot like something
						computer scientists already solved in the 1970s.
					</p>
				</div>

				<div style={sectionStyle}>
					<h4 style={{ marginBottom: '8px' }}>TCP: The Original "Let's Play"</h4>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)' }}>
						When two computers want to talk to each other, they do a three-way handshake:
					</p>
					<div style={codeStyle}>
{`Client  ──SYN──>  Server     "Hey, wanna connect?"
Client  <─SYN-ACK─ Server     "Yeah, I'm here!"
Client  ──ACK──>   Server     "Great, let's go."
         ═══ CONNECTION ESTABLISHED ═══`}
					</div>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)' }}>
						Now look at how a typical gaming session gets organized:
					</p>
					<div style={codeStyle}>
{`Player1 ──CALL──> Group      "let's play!"
Player2 ──IN────> Group      "I'm in!"
Player3 ──IN────> Group      "me too!"
          ═══ SESSION ESTABLISHED ═══`}
					</div>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)', marginTop: '8px' }}>
						The parallel is uncanny. A <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '3px' }}>/call</code> is
						a SYN packet. Each <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '3px' }}>/in</code> is
						a SYN-ACK. When enough people respond, the session is established.
					</p>
				</div>

				<div style={sectionStyle}>
					<h4 style={{ marginBottom: '8px' }}>When Things Go Wrong: Packet Loss</h4>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)' }}>
						In TCP, packets get lost. You get retransmissions, timeouts, RST packets.
						Gaming coordination has its own version:
					</p>
					<div style={codeStyle}>
{`Player1 ──CALL──> Group      2:00 PM
          ... silence ...       (packet loss)
Player1 ──PING──> Player2    4:30 PM  (retransmission)
Player2 ──BRB───> Group      4:45 PM  (partial ACK)
Player1 ──WHERE─> Player2    6:00 PM  (keepalive probe)
Player2 ──IN────> Group      6:15 PM  (delayed ACK)
Player3 ──OUT───> Group      6:20 PM  (RST / connection refused)`}
					</div>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)', marginTop: '8px' }}>
						Some days look like clean three-way handshakes. Others look like packet
						loss with retransmissions scattered everywhere. The <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '3px' }}>/ping</code> command
						is literally a retransmission &mdash; "I sent you a SYN, where's my ACK?"
					</p>
				</div>

				<div style={sectionStyle}>
					<h4 style={{ marginBottom: '8px' }}>The Rally System</h4>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)' }}>
						The rally system standardizes these ad-hoc chat patterns into formal "moves" in a
						game tree. Eight actions cover the full vocabulary of session coordination:
					</p>
					<div style={codeStyle}>
{`/call   SYN        Initiate a session
/in     SYN-ACK    Accept the invitation
/out    RST        Refuse / disconnect
/ping   Retransmit Resend to specific user
/brb    Window=0   Temporarily unavailable
/where  Keepalive  Check if peer is still there
/judge  DNS        System resolves best timing
/tree   Wireshark  Visualize the whole exchange`}
					</div>
				</div>

				<div style={sectionStyle}>
					<h4 style={{ marginBottom: '8px' }}>The Gaming Tree</h4>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)' }}>
						The Gaming Tree takes these interactions and renders them as a directed acyclic graph
						&mdash; like an extensive-form game tree from game theory. Each node is an action, each
						edge is a causal relationship. Calls branch into responses. Pings create
						targeted edges. The judge adds system nodes.
					</p>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)', marginTop: '8px' }}>
						It's part network diagram, part game tree, part social graph. And at the end of
						the day, you can look back and see exactly how your group went from "anyone
						around?" to "GG."
					</p>
				</div>

				<div style={sectionStyle}>
					<h4 style={{ marginBottom: '8px' }}>A Day in the Life</h4>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)' }}>
						Here's what a typical evening coordination looks like, visualized:
					</p>
					<div style={codeStyle}>
{`                                ┌─ ✅ Player2: in ──┐
   📢 Player1: call (later) ───┤                    ├─── 🎮 Session!
                                ├─ ⏳ Player3: brb  ─┤
                                │        │           │
                                │   ❓ Player1       │
                                │   → Player3: where │
                                │        │           │
                                │   ✅ Player3: in ──┘
                                │
                                └─ ❌ Player4: out
                                   "gotta study"`}
					</div>
					<p style={{ lineHeight: '1.6', color: 'var(--text-secondary)', marginTop: '8px' }}>
						Three-way handshake established between Players 1, 2, and 3.
						Player 3 had a partial failure (BRB) requiring a keepalive probe (WHERE),
						but eventually ACK'd. Player 4 sent a RST with reason.
					</p>
				</div>

				<div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
					<p>
						The gaming tree won't solve the fundamental coordination problem &mdash; people are
						still going to be busy, forget, or get distracted. But it gives structure to the
						chaos, and turns an evening of "u there?" messages into something you can actually
						look back at and laugh about.
					</p>
					<p style={{ marginTop: '8px' }}>
						Try <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: '3px' }}>/call</code> in
						Discord or hit the Rally tab to get started.
					</p>
				</div>
			</article>
		</div>
	);
}
