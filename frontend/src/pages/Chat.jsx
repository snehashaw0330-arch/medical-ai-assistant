import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Plus,
  MessageSquareText,
  Bot,
  User,
  Sparkles,
  Trash2,
} from 'lucide-react'
import Button from '@/ui/Button'
import { cn } from '@/lib/utils'

/**
 * Replace this with a real call to Gemini/OpenAI (proxied through your backend
 * so the API key never reaches the browser). The function signature is kept
 * intentionally simple: (messages) => assistantText.
 *
 *   const { reply } = await API.post('/chat', { messages })
 *   return reply
 */
async function generateReply(messages) {
  const last = messages[messages.length - 1]?.content.toLowerCase() || ''
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 600))

  if (/(fever|cough|pain|headache|symptom|sick|cold)/.test(last)) {
    return "It sounds like you're describing symptoms. I can help reason through them, but for a structured assessment head to the **Disease Prediction** tool — it returns the top-3 likely conditions with confidence and explanations. Could you tell me how long you've had these symptoms and their severity?"
  }
  if (/(medicine|drug|tablet|dose|dosage|side effect|substitute)/.test(last)) {
    return 'I can explain medicines — uses, side effects, substitutes and drug class. For exact data, the **Medicine Search** tool queries the full database. Which medicine would you like to know about?'
  }
  if (/(prescription|ocr|handwrit|scan)/.test(last)) {
    return 'You can upload a prescription photo in the **Prescription OCR** tool and I’ll extract the medicines, dosage and frequency — even from messy handwriting. Want me to walk you through it?'
  }
  if (/(hi|hello|hey)/.test(last)) {
    return 'Hello! I’m your MediSense assistant. I can help you understand symptoms, explain medicines, and interpret prescriptions. What would you like to explore?'
  }
  return 'I’m a medical assistant for symptom discussion, medicine explanations and prescription help. Note: I provide general information only — always consult a licensed clinician. How can I help?'
}

const STARTERS = [
  'What could cause a fever with body ache?',
  'Explain the side effects of Azithromycin',
  'How do I read a handwritten prescription?',
]

function newConversation() {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [
      {
        role: 'assistant',
        content:
          'Hi! I’m your **MediSense AI assistant**. Ask me about symptoms, medicines, or prescriptions. I’m here to help you understand — not to replace your doctor.',
      },
    ],
  }
}

export default function Chat() {
  const [conversations, setConversations] = useState([newConversation()])
  const [activeId, setActiveId] = useState(conversations[0].id)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const scrollRef = useRef(null)

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0]

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [active?.messages, typing])

  const updateActive = (updater) =>
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? updater(c) : c)),
    )

  const send = async (text = input) => {
    const content = text.trim()
    if (!content || typing) return
    setInput('')

    const userMsg = { role: 'user', content }
    updateActive((c) => ({
      ...c,
      title: c.messages.length <= 1 ? content.slice(0, 36) : c.title,
      messages: [...c.messages, userMsg],
    }))

    setTyping(true)
    const reply = await generateReply([...active.messages, userMsg])
    setTyping(false)
    updateActive((c) => ({
      ...c,
      messages: [...c.messages, { role: 'assistant', content: reply }],
    }))
  }

  const addChat = () => {
    const c = newConversation()
    setConversations((prev) => [c, ...prev])
    setActiveId(c.id)
  }

  const deleteChat = (id) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id)
      const safe = next.length ? next : [newConversation()]
      if (id === activeId) setActiveId(safe[0].id)
      return safe
    })
  }

  return (
    <div className="grid h-[calc(100vh-8.5rem)] grid-cols-1 gap-4 lg:grid-cols-4">
      {/* History sidebar */}
      <aside className="hidden flex-col rounded-2xl border border-border bg-surface p-3 lg:flex">
        <Button onClick={addChat} className="w-full">
          <Plus size={16} /> New chat
        </Button>
        <div className="mt-3 flex-1 space-y-1 overflow-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                'group flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors',
                c.id === activeId
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted hover:bg-surface-2',
              )}
            >
              <button
                onClick={() => setActiveId(c.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <MessageSquareText size={15} className="shrink-0" />
                <span className="truncate">{c.title}</span>
              </button>
              <button
                onClick={() => deleteChat(c.id)}
                className="opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat window */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface lg:col-span-3">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-white">
            <Bot size={18} />
          </span>
          <div>
            <p className="font-semibold text-foreground">MediSense Assistant</p>
            <p className="text-xs text-success">● Online</p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-5 overflow-auto p-5">
          {active.messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} />
          ))}
          {typing && <TypingBubble />}

          {active.messages.length === 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-sm text-foreground hover:border-primary/50 hover:bg-surface-2"
                >
                  <Sparkles size={13} className="text-primary" /> {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder="Ask about symptoms, medicines, or prescriptions…"
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted"
            />
            <Button size="icon" onClick={() => send()} disabled={!input.trim() || typing}>
              <Send size={16} />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted">
            AI assistant — informational only. Not a substitute for professional care.
          </p>
        </div>
      </div>
    </div>
  )
}

function Bubble({ role, content }) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex animate-fade-up gap-3', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
          isUser ? 'bg-surface-2 text-foreground' : 'bg-gradient-to-br from-primary to-accent text-white',
        )}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </span>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-sm bg-primary text-primary-foreground'
            : 'rounded-tl-sm bg-surface-2 text-foreground',
        )}
        dangerouslySetInnerHTML={{ __html: renderMarkdownLite(content) }}
      />
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="flex gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-white">
        <Bot size={16} />
      </span>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-3.5">
        <span className="typing-dot h-2 w-2 rounded-full bg-muted" style={{ animationDelay: '0ms' }} />
        <span className="typing-dot h-2 w-2 rounded-full bg-muted" style={{ animationDelay: '200ms' }} />
        <span className="typing-dot h-2 w-2 rounded-full bg-muted" style={{ animationDelay: '400ms' }} />
      </div>
    </div>
  )
}

// Minimal, safe-ish markdown: only **bold**. Escapes HTML first.
function renderMarkdownLite(text) {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}
