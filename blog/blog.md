# The Gaming Tree: When Scheduling Feels Like a TCP Handshake

*February 2026*

## The Problem

If you've ever tried to get 4–5 friends online at the same time, you know the drill. Someone drops a *"play tonight?"* in Discord at 2 PM. Three hours pass. Someone says *"maybe."* Two more hours. Another person says *"I'm in after dinner."* By 9 PM you've got three people ready, one who went AFK, and one who forgot they said yes.

This is a coordination problem. And it turns out it looks *uncannily* like something computer scientists formalized in the 1970s.

![](assets/handshake.png)

## TCP: The Original "Let's Play"

When two computers want to talk reliably, they don't just start sending payloads. They first establish a connection with a **three-way handshake**:

```bash
Client  ──SYN────>  Server     "Hey, can we connect?"
Client  <─SYN-ACK── Server     "Yes, I'm here."
Client  ──ACK────>  Server     "Great, let's begin."
         ═══ CONNECTION ESTABLISHED ═══
```

The handshake is small but profound: each step confirms liveness, intent, and readiness -- before anyone commits to the real conversation.

Now compare it to organizing a gaming session:

```bash
Player A ──CALL──> Group      "play tonight?"
Player B ──IN────> Group      "I'm in."
Player C ──IN────> Group      "same."
System  ──LOCK───> Group      "9 PM confirmed."
         ═══ SESSION ESTABLISHED ═══
```

The parallel is not perfect (humans are a bit more… lossy), but it's close enough to be suspicious.

## The Real Picture: Two Lifelines, Red/Blue Arrows, and Very Human Packets

In practice, coordination doesn't look like a tidy textbook handshake. It looks like the trace in the figure above:

- Two vertical **lifelines** (one per participant).
- **Red arrows** for outbound proposals (our "SYN" moments).
- **Blue arrows** for confirmations (our "ACK-ish" moments).
- Margin annotations like "receives SYN," "sends ACK," etc., almost as if Discord were a network stack with feelings.

One technical clarification (before the networking purists object):

> In standard TCP, the server replies with a single **SYN+ACK** segment, not separate "SYN" and "ACK" packets.  
> Our diagram is a stylized social trace: a human reply often both acknowledges the call and signals readiness, so we label it conceptually as "SYN-ACK."

## When Things Go Wrong: Human Packet Loss

TCP assumes packets will be dropped. So it builds in timeouts, retransmissions, and resets.

Gaming coordination exhibits the same patterns, just with better excuses.

```
Player A ──CALL──> Group      2:00 PM
          ... silence ...       (packet loss)
Player A ──PING──> Player B    4:30 PM  (retransmission)
Player B ──BRB───> Group       4:45 PM  (window temporarily closed)
Player A ──WHERE─> Player B    6:00 PM  (keepalive probe)
Player B ──IN────> Group       6:15 PM  (delayed ACK)
Player D ──OUT───> Group       6:20 PM  (RST / connection refused)
```

Some evenings resemble clean handshakes. Others resemble congested networks with jitter and unreliable peers.

The `/ping` is effectively a retransmission:  
"I sent you a SYN. I'm still waiting for your ACK."

## The Rally System: Turning Chat Into Explicit Moves

Rally formalizes these coordination patterns into a small set of explicit actions:

```
/call    ≈ SYN          Initiate session proposal
/in      ≈ SYN+ACK      Acknowledge + signal availability
/lock    ≈ ACK          Confirm chosen time (explicit or system-triggered)
/out     ≈ RST          Refuse / disconnect
/ping    ≈ Retransmit   Direct reminder
/brb     ≈ Window=0     Temporarily unavailable
/where   ≈ Keepalive    Check liveness
/judge   ≈ Scheduler    Suggest optimal time
/tree    ≈ Wireshark    Visualize full exchange
```

Two subtle but important notes:

- `/in` functions like a SYN-ACK socially, even though humans don't set packet flags.
- The final ACK often appears as a system confirmation ("locked at 9") once quorum is reached.

## The Gaming Tree

The Gaming Tree renders coordination as a **time-ordered directed graph**:

- Each node is an action (`/call`, `/in`, `/ping`, etc.).
- Each edge represents a causal relationship.
- Edges always point forward in time, so the structure forms a **DAG**.

It is part network trace, part extensive-form game tree, part social coordination map.

Instead of scrolling through fragmented chat history, you see the structure of agreement.

## A Day in the Life

A typical evening trace might look like this:

```
📢 Player A: /call
│
├── ✅ Player B: /in
│
├── ⏳ Player C: /brb
│     └── ❓ Player A: /where
│           └── ✅ Player C: /in
│
└── ❌ Player D: /out
      "gotta study"

🎮 Session Locked (A, B, C)
```

Three-way handshake established among A, B, and C after a temporary pause and a keepalive probe. Player D sends a polite RST.

## Why Structure Matters

The gaming tree won't solve the fundamental coordination problem; people are still going to be busy, forget, or get distracted.

But it gives structure to the chaos, and turns an evening of "u there?" messages into something you can actually look back at and laugh about.

Try `/call` in Discord or open the Rally tab to see your own handshake unfold.