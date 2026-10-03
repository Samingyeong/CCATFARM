import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface AccordionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

/** 기본 접힘 상태의 아코디언 (Recommended Action 등) */
export default function Accordion({ title, defaultOpen = false, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="accordion">
      <button className="accordion-head" onClick={() => setOpen((o) => !o)}>
        {title}
        {open ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  )
}
