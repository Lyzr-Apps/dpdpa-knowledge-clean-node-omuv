'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { callAIAgent, type AIAgentResponse } from '@/lib/aiAgent'
import parseLLMJson from '@/lib/jsonParser'
import { KnowledgeBaseUpload } from '@/components/KnowledgeBaseUpload'
import { listSchedules, getScheduleLogs, pauseSchedule, resumeSchedule, cronToHuman, type Schedule, type ExecutionLog } from '@/lib/scheduler'
import { FiMessageSquare, FiRefreshCw, FiDatabase, FiSend, FiChevronDown, FiChevronRight, FiExternalLink, FiClock, FiAlertCircle, FiCheck, FiX, FiMenu, FiSearch, FiBookOpen, FiShield, FiFileText, FiCalendar, FiPlay, FiPause } from 'react-icons/fi'
import { HiOutlineScale } from 'react-icons/hi'
import { RiGovernmentLine } from 'react-icons/ri'

// ── Constants ──────────────────────────────────────────────────────────────────
const LEGAL_AGENT_ID = '699be53fabc429f336b46816'
const MEITY_AGENT_ID = '699be53f0ed57996e7d19026'
const LEGAL_KB_RAG_ID = '699be518e12ce16820316e45'
const MEITY_KB_RAG_ID = '699be5183dc9e9e5282863a1'
const SCHEDULE_ID = '699be546399dfadeac3879a6'

// ── Interfaces ─────────────────────────────────────────────────────────────────
interface SourceCitation {
  act: string
  section: string
  description: string
}

interface ParsedLegalResponse {
  answer: string
  sources: SourceCitation[]
  cross_framework_analysis: string
  precedence_notes: string
  compliance_steps: string[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  parsed?: ParsedLegalResponse
  frameworks?: string[]
  isLoading?: boolean
  error?: string
}

interface RegulatoryUpdate {
  title: string
  date: string
  summary: string
  affected_provisions: string[]
  impact_level: string
  framework: string
  source_url: string
}

type ActiveTab = 'chat' | 'updates' | 'knowledge'
type FrameworkFilter = 'All' | 'DPDPA' | 'IT Act 2000' | 'IT Act 2008'

// ── Helpers ────────────────────────────────────────────────────────────────────
function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36)
}

function detectFrameworks(text: string, sources: SourceCitation[]): string[] {
  const frameworks: string[] = []
  const combined = (text || '') + ' ' + JSON.stringify(sources || [])
  if (/DPDPA|Digital Personal Data Protection/i.test(combined)) frameworks.push('DPDPA')
  if (/IT Act 2000|Information Technology Act.?2000/i.test(combined)) frameworks.push('IT Act 2000')
  if (/IT Act 2008|IT.?Amendment.?Act.?2008/i.test(combined)) frameworks.push('IT Act 2008')
  return frameworks.length ? frameworks : ['General']
}

function getImpactBadgeClasses(level: string): string {
  const l = (level || '').toLowerCase()
  if (l === 'critical') return 'bg-red-100 text-red-700 border border-red-200'
  if (l === 'high') return 'bg-orange-100 text-orange-700 border border-orange-200'
  if (l === 'medium') return 'bg-yellow-100 text-yellow-700 border border-yellow-200'
  return 'bg-green-100 text-green-700 border border-green-200'
}

function getFrameworkBadgeClasses(fw: string): string {
  const f = (fw || '').toLowerCase()
  if (f.includes('dpdpa')) return 'bg-[#6B3A1B]/10 text-[#6B3A1B] border border-[#6B3A1B]/20'
  if (f.includes('2000')) return 'bg-[#AA8D19]/10 text-[#AA8D19] border border-[#AA8D19]/20'
  if (f.includes('2008')) return 'bg-[#3D5A20]/10 text-[#3D5A20] border border-[#3D5A20]/20'
  return 'bg-[#8A7A6A]/10 text-[#8A7A6A] border border-[#8A7A6A]/20'
}

// ── Markdown Renderer ──────────────────────────────────────────────────────────
function formatInline(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-[#2B231B]">{part}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  )
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null
  return (
    <div className="space-y-2">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### '))
          return <h4 key={i} className="font-semibold text-sm mt-3 mb-1 text-[#2B231B]">{line.slice(4)}</h4>
        if (line.startsWith('## '))
          return <h3 key={i} className="font-semibold text-base mt-3 mb-1 text-[#2B231B]">{line.slice(3)}</h3>
        if (line.startsWith('# '))
          return <h2 key={i} className="font-bold text-lg mt-4 mb-2 text-[#2B231B]">{line.slice(2)}</h2>
        if (line.startsWith('- ') || line.startsWith('* '))
          return <li key={i} className="ml-4 list-disc text-sm text-[#2B231B] leading-relaxed">{formatInline(line.slice(2))}</li>
        if (/^\d+\.\s/.test(line))
          return <li key={i} className="ml-4 list-decimal text-sm text-[#2B231B] leading-relaxed">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} className="text-sm text-[#2B231B] leading-relaxed">{formatInline(line)}</p>
      })}
    </div>
  )
}

// ── ErrorBoundary ──────────────────────────────────────────────────────────────
class InlineErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F3EFEA] text-[#2B231B]">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-[#8A7A6A] mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 bg-[#6B3A1B] text-[#FBF9F6] rounded-lg text-sm hover:bg-[#5A3016] transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Collapsible Section ────────────────────────────────────────────────────────
function CollapsibleSection({ title, icon, children, defaultOpen = false }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  return (
    <div className="border border-[#DDD8D1] rounded-lg overflow-hidden bg-[#EAE4DA]/50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-3 text-left text-sm font-medium text-[#2B231B] hover:bg-[#DDD8D1]/50 transition-colors"
      >
        {isOpen ? <FiChevronDown className="w-4 h-4 text-[#6B3A1B] flex-shrink-0" /> : <FiChevronRight className="w-4 h-4 text-[#6B3A1B] flex-shrink-0" />}
        <span className="flex-shrink-0">{icon}</span>
        <span>{title}</span>
      </button>
      {isOpen && <div className="px-4 pb-3 pt-0">{children}</div>}
    </div>
  )
}

// ── Agent Response Card ────────────────────────────────────────────────────────
function AgentResponseCard({ msg }: { msg: ChatMessage }) {
  const parsed = msg.parsed
  const frameworks = msg.frameworks || []

  return (
    <div className="space-y-3">
      {frameworks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {frameworks.map((fw) => (
            <span key={fw} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getFrameworkBadgeClasses(fw)}`}>
              {fw}
            </span>
          ))}
        </div>
      )}

      {parsed?.answer ? renderMarkdown(parsed.answer) : renderMarkdown(msg.content)}

      {Array.isArray(parsed?.sources) && parsed.sources.length > 0 && (
        <CollapsibleSection title={`Source Citations (${parsed.sources.length})`} icon={<FiBookOpen className="w-4 h-4 text-[#AA8D19]" />}>
          <div className="space-y-2">
            {parsed.sources.map((src, i) => (
              <div key={i} className="flex flex-col gap-1 p-2 rounded bg-[#F3EFEA] border border-[#DDD8D1]">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${getFrameworkBadgeClasses(src?.act || '')}`}>
                    {src?.act ?? 'Unknown Act'}
                  </span>
                  <span className="text-xs font-mono text-[#6B3A1B] font-medium">{src?.section ?? ''}</span>
                </div>
                <p className="text-xs text-[#8A7A6A] leading-relaxed">{src?.description ?? ''}</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {parsed?.cross_framework_analysis && (
        <CollapsibleSection title="Cross-Framework Analysis" icon={<FiShield className="w-4 h-4 text-[#6B3A1B]" />}>
          {renderMarkdown(parsed.cross_framework_analysis)}
        </CollapsibleSection>
      )}

      {parsed?.precedence_notes && (
        <CollapsibleSection title="Precedence Notes" icon={<HiOutlineScale className="w-4 h-4 text-[#AA8D19]" />}>
          {renderMarkdown(parsed.precedence_notes)}
        </CollapsibleSection>
      )}

      {Array.isArray(parsed?.compliance_steps) && parsed.compliance_steps.length > 0 && (
        <CollapsibleSection title={`Compliance Steps (${parsed.compliance_steps.length})`} icon={<FiCheck className="w-4 h-4 text-[#3D5A20]" />} defaultOpen>
          <ol className="space-y-1.5 list-none">
            {parsed.compliance_steps.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#2B231B] leading-relaxed">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#6B3A1B] text-[#FBF9F6] text-xs flex items-center justify-center font-medium mt-0.5">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </CollapsibleSection>
      )}
    </div>
  )
}

// ── Update Card ────────────────────────────────────────────────────────────────
function UpdateCard({ update, reviewed, onReview }: {
  update: RegulatoryUpdate
  reviewed: boolean
  onReview: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const handleClick = () => {
    setExpanded(!expanded)
    if (!reviewed) onReview()
  }

  return (
    <div className="relative border border-[#DDD8D1] rounded-lg bg-[#EAE4DA] shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={handleClick}>
      <div className="absolute -left-3 top-6 w-2.5 h-2.5 rounded-full border-2 border-[#6B3A1B] bg-[#F3EFEA]" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#6B3A1B]/10 text-[#6B3A1B]">
                <FiCalendar className="w-3 h-3" />
                {update?.date ?? 'N/A'}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getFrameworkBadgeClasses(update?.framework || '')}`}>
                {update?.framework ?? 'Unknown'}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getImpactBadgeClasses(update?.impact_level || '')}`}>
                {update?.impact_level ?? 'N/A'}
              </span>
              {!reviewed && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#AA8D19]/20 text-[#AA8D19] border border-[#AA8D19]/30">New</span>
              )}
              {reviewed && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#DDD8D1] text-[#8A7A6A]">Reviewed</span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-[#2B231B] mb-1">{update?.title ?? 'Untitled Update'}</h3>
            {!expanded && <p className="text-xs text-[#8A7A6A] line-clamp-2">{update?.summary ?? ''}</p>}
          </div>
          <div className="flex-shrink-0 mt-1">
            {expanded ? <FiChevronDown className="w-4 h-4 text-[#8A7A6A]" /> : <FiChevronRight className="w-4 h-4 text-[#8A7A6A]" />}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-[#DDD8D1] space-y-3">
            {update?.summary && (
              <div>
                <h4 className="text-xs font-semibold text-[#6B3A1B] uppercase tracking-wider mb-1">Full Summary</h4>
                {renderMarkdown(update.summary)}
              </div>
            )}
            {Array.isArray(update?.affected_provisions) && update.affected_provisions.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-[#6B3A1B] uppercase tracking-wider mb-1">Affected Provisions</h4>
                <div className="flex flex-wrap gap-1">
                  {update.affected_provisions.map((prov, i) => (
                    <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-[#F3EFEA] text-[#2B231B] border border-[#DDD8D1]">{prov}</span>
                  ))}
                </div>
              </div>
            )}
            {update?.source_url && (
              <a
                href={update.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#6B3A1B] hover:text-[#AA8D19] font-medium transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <FiExternalLink className="w-3 h-3" />
                View Source Document
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Schedule Management ────────────────────────────────────────────────────────
function SchedulePanel() {
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')

  const loadScheduleData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const schedulesResult = await listSchedules()
      if (schedulesResult.success && Array.isArray(schedulesResult.schedules)) {
        const found = schedulesResult.schedules.find((s) => s.id === SCHEDULE_ID)
        if (found) {
          setSchedule(found)
        }
      }
      const logsResult = await getScheduleLogs(SCHEDULE_ID, { limit: 5 })
      if (logsResult.success && Array.isArray(logsResult.executions)) {
        setLogs(logsResult.executions)
      }
    } catch {
      setError('Failed to load schedule data')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadScheduleData()
  }, [loadScheduleData])

  const handleToggle = async () => {
    if (!schedule) return
    setActionLoading(true)
    setError('')
    try {
      if (schedule.is_active) {
        await pauseSchedule(schedule.id)
      } else {
        await resumeSchedule(schedule.id)
      }
      await loadScheduleData()
    } catch {
      setError('Failed to toggle schedule')
    }
    setActionLoading(false)
  }

  if (loading) {
    return (
      <div className="border border-[#DDD8D1] rounded-lg bg-[#EAE4DA] p-4">
        <div className="flex items-center gap-2 text-sm text-[#8A7A6A]">
          <FiRefreshCw className="w-4 h-4 animate-spin" />
          Loading schedule...
        </div>
      </div>
    )
  }

  return (
    <div className="border border-[#DDD8D1] rounded-lg bg-[#EAE4DA] shadow-sm">
      <div className="p-4 border-b border-[#DDD8D1]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FiClock className="w-4 h-4 text-[#6B3A1B]" />
            <h3 className="text-sm font-semibold text-[#2B231B]">Schedule Management</h3>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${schedule?.is_active ? 'bg-green-100 text-green-700' : 'bg-[#DDD8D1] text-[#8A7A6A]'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${schedule?.is_active ? 'bg-green-500' : 'bg-[#8A7A6A]'}`} />
            {schedule?.is_active ? 'Active' : 'Paused'}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-[#F3EFEA] border border-[#DDD8D1]">
            <p className="text-xs text-[#8A7A6A] uppercase tracking-wider mb-1">Frequency</p>
            <p className="text-sm font-medium text-[#2B231B]">{cronToHuman('0 9 * * *')}</p>
            <p className="text-xs text-[#8A7A6A] mt-0.5">Asia/Kolkata (IST)</p>
          </div>
          <div className="p-3 rounded-lg bg-[#F3EFEA] border border-[#DDD8D1]">
            <p className="text-xs text-[#8A7A6A] uppercase tracking-wider mb-1">Next Run</p>
            <p className="text-sm font-medium text-[#2B231B]">
              {schedule?.next_run_time ? new Date(schedule.next_run_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}
            </p>
          </div>
        </div>

        <button
          onClick={handleToggle}
          disabled={actionLoading}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${schedule?.is_active ? 'bg-[#DDD8D1] text-[#2B231B] hover:bg-[#D0CBC3]' : 'bg-[#6B3A1B] text-[#FBF9F6] hover:bg-[#5A3016]'} disabled:opacity-50`}
        >
          {actionLoading ? (
            <FiRefreshCw className="w-4 h-4 animate-spin" />
          ) : schedule?.is_active ? (
            <><FiPause className="w-4 h-4" /> Pause Schedule</>
          ) : (
            <><FiPlay className="w-4 h-4" /> Resume Schedule</>
          )}
        </button>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {logs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-[#6B3A1B] uppercase tracking-wider mb-2">Recent Executions</h4>
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-2 rounded bg-[#F3EFEA] border border-[#DDD8D1] text-xs">
                  <div className="flex items-center gap-2">
                    {log.success ? (
                      <FiCheck className="w-3.5 h-3.5 text-green-600" />
                    ) : (
                      <FiX className="w-3.5 h-3.5 text-red-500" />
                    )}
                    <span className="text-[#2B231B]">{log.executed_at ? new Date(log.executed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}</span>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {log.success ? 'Success' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sample Data ────────────────────────────────────────────────────────────────
const SAMPLE_MESSAGES: ChatMessage[] = [
  {
    id: 'sample-1',
    role: 'user',
    content: 'What are the consent requirements under DPDPA?',
    timestamp: new Date(Date.now() - 120000).toISOString(),
  },
  {
    id: 'sample-2',
    role: 'assistant',
    content: '',
    timestamp: new Date(Date.now() - 60000).toISOString(),
    frameworks: ['DPDPA'],
    parsed: {
      answer: 'Under the **Digital Personal Data Protection Act (DPDPA) 2023**, consent is a cornerstone principle. The Act mandates that any Data Fiduciary processing personal data must obtain **free, specific, informed, unconditional, and unambiguous** consent from the Data Principal.\n\n### Key Consent Requirements:\n- Consent must be obtained for a **clear and specific purpose**\n- The Data Principal must be given a notice in **clear and plain language** before consent is obtained\n- Consent can be **withdrawn** at any time with the same ease as it was given\n- **Affirmative action** is required - silence or pre-ticked boxes do not constitute valid consent\n- For children\'s data, consent from a **verifiable parent or legal guardian** is required',
      sources: [
        { act: 'DPDPA 2023', section: 'Section 6', description: 'Consent as a basis for processing personal data' },
        { act: 'DPDPA 2023', section: 'Section 7', description: 'Notice requirements for data processing' },
        { act: 'DPDPA 2023', section: 'Section 9', description: 'Processing of children\'s personal data' },
      ],
      cross_framework_analysis: 'The DPDPA\'s consent framework is more prescriptive than the IT Act 2000\'s general provisions. While the IT Act 2000 under Section 43A and the IT (Reasonable Security Practices) Rules 2011 required consent for collection of sensitive personal data, the DPDPA establishes a comprehensive consent architecture covering all personal data, not just sensitive data.',
      precedence_notes: 'DPDPA takes precedence over the IT Act provisions for data protection matters. Section 44 of DPDPA explicitly states that the provisions of DPDPA shall have effect notwithstanding anything inconsistent in any other law.',
      compliance_steps: [
        'Implement a consent management platform that captures free, specific, informed consent',
        'Provide clear and plain language notice before collecting personal data',
        'Ensure consent withdrawal mechanism is equally easy as consent provision',
        'Implement separate consent flows for children\'s data with parental verification',
        'Maintain records of consent obtained for audit and compliance purposes',
      ],
    },
  },
]

const SAMPLE_UPDATES: RegulatoryUpdate[] = [
  {
    title: 'DPDPA Draft Rules Released for Public Consultation',
    date: '2024-01-15',
    summary: 'MeitY has published draft rules under the Digital Personal Data Protection Act 2023 for public consultation. The rules cover Data Fiduciary obligations, consent manager registration, and cross-border data transfer guidelines.',
    affected_provisions: ['Section 8 - General Obligations', 'Section 10 - Consent Manager', 'Section 16 - Cross-border Transfer'],
    impact_level: 'Critical',
    framework: 'DPDPA',
    source_url: 'https://www.meity.gov.in',
  },
  {
    title: 'IT Act Amendment Notification on Cybersecurity Reporting',
    date: '2024-01-10',
    summary: 'CERT-In has updated the mandatory incident reporting timeline from 6 hours to 72 hours for non-critical incidents under the IT Act 2000.',
    affected_provisions: ['Section 70B - CERT-In Functions', 'CERT-In Directions April 2022'],
    impact_level: 'High',
    framework: 'IT Act 2000',
    source_url: 'https://www.cert-in.org.in',
  },
  {
    title: 'Significant Data Fiduciary Notification Criteria Published',
    date: '2024-01-05',
    summary: 'The government has outlined criteria for designating entities as Significant Data Fiduciaries, including volume of data processed and potential impact on data principals.',
    affected_provisions: ['Section 10 - Significant Data Fiduciary Obligations', 'Section 11 - Data Protection Impact Assessment'],
    impact_level: 'High',
    framework: 'DPDPA',
    source_url: 'https://www.meity.gov.in',
  },
]

const SUGGESTED_QUERIES = [
  'What are the consent requirements under DPDPA?',
  'How does IT Act 2008 amend IT Act 2000?',
  'What are the data breach notification obligations?',
  'Compare penalties under DPDPA and IT Act 2000',
  'What are Significant Data Fiduciary obligations?',
]

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Page() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sampleData, setSampleData] = useState(false)

  const [sessionId] = useState(() => 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [frameworkFilter, setFrameworkFilter] = useState<FrameworkFilter>('All')
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  const [updates, setUpdates] = useState<RegulatoryUpdate[]>([])
  const [updatesSummary, setUpdatesSummary] = useState('')
  const [updatesLastChecked, setUpdatesLastChecked] = useState('')
  const [updatesLoading, setUpdatesLoading] = useState(false)
  const [updatesError, setUpdatesError] = useState('')
  const [reviewedUpdates, setReviewedUpdates] = useState<Set<number>>(new Set())

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const displayMessages = sampleData && messages.length === 0 ? SAMPLE_MESSAGES : messages
  const displayUpdates = sampleData && updates.length === 0 ? SAMPLE_UPDATES : updates

  // ── Chat Handler ───────────────────────────────────────────────────────────
  const handleSendMessage = async (overrideMessage?: string) => {
    const userMessage = overrideMessage || inputValue.trim()
    if (!userMessage || chatLoading) return

    const finalMessage = frameworkFilter !== 'All' ? `[${frameworkFilter}] ${userMessage}` : userMessage

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    }

    const loadingMsgId = generateId()
    const loadingMsg: ChatMessage = {
      id: loadingMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isLoading: true,
    }

    setMessages((prev) => [...prev, userMsg, loadingMsg])
    setInputValue('')
    setChatLoading(true)
    setActiveAgentId(LEGAL_AGENT_ID)

    try {
      const result: AIAgentResponse = await callAIAgent(finalMessage, LEGAL_AGENT_ID, { session_id: sessionId })

      if (result.success) {
        const parsed = parseLLMJson(result.response?.result)

        const answerText =
          parsed?.answer ||
          (typeof result.response?.result === 'object' ? result.response?.result?.answer : '') ||
          result.response?.message ||
          result.response?.result?.text ||
          (typeof result.response?.result === 'string' ? result.response.result : '') ||
          'Unable to parse response'

        const sources: SourceCitation[] = Array.isArray(parsed?.sources) ? parsed.sources : []
        const crossFramework: string = parsed?.cross_framework_analysis || ''
        const precedenceNotes: string = parsed?.precedence_notes || ''
        const complianceSteps: string[] = Array.isArray(parsed?.compliance_steps) ? parsed.compliance_steps : []

        const detectedFrameworks = detectFrameworks(answerText, sources)

        const assistantMsg: ChatMessage = {
          id: loadingMsgId,
          role: 'assistant',
          content: answerText,
          timestamp: new Date().toISOString(),
          parsed: {
            answer: answerText,
            sources,
            cross_framework_analysis: crossFramework,
            precedence_notes: precedenceNotes,
            compliance_steps: complianceSteps,
          },
          frameworks: detectedFrameworks,
        }

        setMessages((prev) => prev.map((m) => (m.id === loadingMsgId ? assistantMsg : m)))
      } else {
        const errorMsg: ChatMessage = {
          id: loadingMsgId,
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          error: result.error || 'Failed to get response from Legal Knowledge Assistant',
        }
        setMessages((prev) => prev.map((m) => (m.id === loadingMsgId ? errorMsg : m)))
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: loadingMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        error: 'Network error. Please try again.',
      }
      setMessages((prev) => prev.map((m) => (m.id === loadingMsgId ? errorMsg : m)))
    }

    setChatLoading(false)
    setActiveAgentId(null)
  }

  // ── Updates Handler ────────────────────────────────────────────────────────
  const handleCheckUpdates = async () => {
    if (updatesLoading) return
    setUpdatesLoading(true)
    setUpdatesError('')
    setActiveAgentId(MEITY_AGENT_ID)

    try {
      const result: AIAgentResponse = await callAIAgent(
        'Check for latest regulatory updates from MeitY portal regarding DPDPA, IT Act 2000, and IT Act 2008',
        MEITY_AGENT_ID
      )

      if (result.success) {
        const parsed = parseLLMJson(result.response?.result)

        const newUpdates: RegulatoryUpdate[] = Array.isArray(parsed?.updates) ? parsed.updates : []
        const summary: string = parsed?.summary || ''
        const lastChecked: string = parsed?.last_checked || new Date().toISOString()

        setUpdates(newUpdates)
        setUpdatesSummary(summary)
        setUpdatesLastChecked(lastChecked)
        setReviewedUpdates(new Set())
      } else {
        setUpdatesError(result.error || 'Failed to check for updates')
      }
    } catch {
      setUpdatesError('Network error. Please try again.')
    }

    setUpdatesLoading(false)
    setActiveAgentId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const navItems: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: 'Chat', icon: <FiMessageSquare className="w-4 h-4" /> },
    { id: 'updates', label: 'Updates', icon: <FiRefreshCw className="w-4 h-4" /> },
    { id: 'knowledge', label: 'Knowledge Sources', icon: <FiDatabase className="w-4 h-4" /> },
  ]

  return (
    <InlineErrorBoundary>
      <div className="min-h-screen bg-[#F3EFEA] text-[#2B231B] flex">
        {/* Mobile menu button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg bg-[#EAE4DA] border border-[#DDD8D1] shadow-sm hover:bg-[#DDD8D1] transition-colors"
        >
          <FiMenu className="w-5 h-5 text-[#6B3A1B]" />
        </button>

        {/* Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-[#E9E3D9] border-r border-[#DDD8D1] flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <div className="p-5 border-b border-[#DDD8D1]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#6B3A1B] flex items-center justify-center flex-shrink-0">
                <HiOutlineScale className="w-5 h-5 text-[#FBF9F6]" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-[#2B231B] tracking-wide leading-tight">DPDPA & IT Act</h1>
                <p className="text-xs text-[#8A7A6A]">Legal Knowledge Base</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id)
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === item.id ? 'bg-[#6B3A1B] text-[#FBF9F6]' : 'text-[#2B231B] hover:bg-[#DDD8D1]'}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* Sample data toggle */}
          <div className="p-3 border-t border-[#DDD8D1]">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs text-[#8A7A6A]">Sample Data</span>
              <button
                onClick={() => setSampleData(!sampleData)}
                className={`relative w-9 h-5 rounded-full transition-colors ${sampleData ? 'bg-[#6B3A1B]' : 'bg-[#DDD8D1]'}`}
                aria-label="Toggle sample data"
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${sampleData ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          </div>

          {/* Agent Info */}
          <div className="p-3 border-t border-[#DDD8D1] space-y-2">
            <p className="text-xs font-semibold text-[#8A7A6A] uppercase tracking-wider px-3">Agents</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeAgentId === LEGAL_AGENT_ID ? 'bg-[#AA8D19] animate-pulse' : 'bg-green-500'}`} />
                <span className="text-xs text-[#2B231B] truncate">Legal Knowledge Assistant</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeAgentId === MEITY_AGENT_ID ? 'bg-[#AA8D19] animate-pulse' : 'bg-green-500'}`} />
                <span className="text-xs text-[#2B231B] truncate">MeitY Update Monitor</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-h-screen min-w-0">
          {/* ── Chat Tab ──────────────────────────────────────────────── */}
          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col">
              <div className="p-4 pl-14 lg:pl-4 border-b border-[#DDD8D1] bg-[#EAE4DA]">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[#2B231B] font-serif">Legal Knowledge Assistant</h2>
                    <p className="text-xs text-[#8A7A6A]">Ask about DPDPA, IT Act 2000, or IT Act 2008 provisions</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {(['All', 'DPDPA', 'IT Act 2000', 'IT Act 2008'] as FrameworkFilter[]).map((fw) => (
                    <button
                      key={fw}
                      onClick={() => setFrameworkFilter(fw)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${frameworkFilter === fw ? 'bg-[#6B3A1B] text-[#FBF9F6] border-[#6B3A1B]' : 'bg-[#F3EFEA] text-[#2B231B] border-[#DDD8D1] hover:border-[#6B3A1B]/40'}`}
                    >
                      {fw}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {displayMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <div className="w-16 h-16 rounded-2xl bg-[#6B3A1B]/10 flex items-center justify-center mb-4">
                      <HiOutlineScale className="w-8 h-8 text-[#6B3A1B]" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#2B231B] mb-2 font-serif">Welcome to Legal Knowledge Base</h3>
                    <p className="text-sm text-[#8A7A6A] mb-6 max-w-md leading-relaxed">Ask questions about the Digital Personal Data Protection Act, IT Act 2000, and IT Act 2008 amendments. Get comprehensive legal analysis with source citations.</p>
                    <div className="space-y-2 w-full max-w-md">
                      <p className="text-xs text-[#8A7A6A] font-medium uppercase tracking-wider">Suggested queries</p>
                      {SUGGESTED_QUERIES.map((query, i) => (
                        <button
                          key={i}
                          onClick={() => handleSendMessage(query)}
                          className="w-full text-left p-3 rounded-lg border border-[#DDD8D1] bg-[#EAE4DA] hover:bg-[#DDD8D1] transition-colors text-sm text-[#2B231B]"
                        >
                          <FiSearch className="w-3 h-3 inline mr-2 text-[#6B3A1B]" />
                          {query}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {displayMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] lg:max-w-[70%] rounded-xl p-4 ${msg.role === 'user' ? 'bg-[#6B3A1B] text-[#FBF9F6]' : 'bg-[#EAE4DA] border border-[#DDD8D1] shadow-sm'}`}>
                      {msg.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-[#8A7A6A]">
                          <FiRefreshCw className="w-4 h-4 animate-spin" />
                          Analyzing legal provisions...
                        </div>
                      ) : msg.error ? (
                        <div className="flex items-center gap-2 text-sm text-red-600">
                          <FiAlertCircle className="w-4 h-4 flex-shrink-0" />
                          {msg.error}
                        </div>
                      ) : msg.role === 'user' ? (
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      ) : (
                        <AgentResponseCard msg={msg} />
                      )}
                      <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-[#FBF9F6]/60' : 'text-[#8A7A6A]'}`}>
                        {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 border-t border-[#DDD8D1] bg-[#EAE4DA]">
                <div className="flex items-center gap-2 max-w-4xl mx-auto">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about DPDPA, IT Act 2000, or IT Act 2008..."
                    disabled={chatLoading}
                    className="flex-1 px-4 py-3 rounded-lg bg-[#F3EFEA] border border-[#DDD8D1] text-sm text-[#2B231B] placeholder-[#8A7A6A] focus:outline-none focus:ring-2 focus:ring-[#6B3A1B]/30 focus:border-[#6B3A1B] disabled:opacity-50 transition-all"
                  />
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={chatLoading || !inputValue.trim()}
                    className="p-3 rounded-lg bg-[#6B3A1B] text-[#FBF9F6] hover:bg-[#5A3016] disabled:opacity-40 transition-colors flex-shrink-0"
                  >
                    <FiSend className="w-4 h-4" />
                  </button>
                </div>
                {frameworkFilter !== 'All' && (
                  <p className="text-xs text-[#8A7A6A] mt-2 text-center">
                    Filtering by: <span className="font-medium text-[#6B3A1B]">{frameworkFilter}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Updates Tab ─────────────────────────────────────────── */}
          {activeTab === 'updates' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 pl-14 lg:pl-4 border-b border-[#DDD8D1] bg-[#EAE4DA]">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-[#2B231B] font-serif">Regulatory Updates</h2>
                    <p className="text-xs text-[#8A7A6A]">
                      {updatesLastChecked
                        ? `Last checked: ${new Date(updatesLastChecked).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
                        : 'Monitor MeitY portal for DPDPA and IT Act updates'}
                    </p>
                  </div>
                  <button
                    onClick={handleCheckUpdates}
                    disabled={updatesLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B3A1B] text-[#FBF9F6] text-sm font-medium hover:bg-[#5A3016] disabled:opacity-50 transition-colors"
                  >
                    <FiRefreshCw className={`w-4 h-4 ${updatesLoading ? 'animate-spin' : ''}`} />
                    {updatesLoading ? 'Checking...' : 'Check for Updates'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {updatesError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
                    <div className="flex items-center gap-2">
                      <FiAlertCircle className="w-4 h-4 flex-shrink-0" />
                      {updatesError}
                    </div>
                  </div>
                )}

                {updatesSummary && (
                  <div className="mb-6 p-4 rounded-lg border border-[#DDD8D1] bg-[#EAE4DA] shadow-sm">
                    <h3 className="text-sm font-semibold text-[#6B3A1B] uppercase tracking-wider mb-2">Regulatory Landscape Summary</h3>
                    {renderMarkdown(updatesSummary)}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    {displayUpdates.length > 0 ? (
                      <div className="relative pl-4 border-l-2 border-[#DDD8D1] space-y-4">
                        {displayUpdates.map((update, i) => (
                          <UpdateCard
                            key={i}
                            update={update}
                            reviewed={reviewedUpdates.has(i)}
                            onReview={() => setReviewedUpdates((prev) => {
                              const next = new Set(prev)
                              next.add(i)
                              return next
                            })}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-14 h-14 rounded-xl bg-[#6B3A1B]/10 flex items-center justify-center mb-4">
                          <RiGovernmentLine className="w-7 h-7 text-[#6B3A1B]" />
                        </div>
                        <h3 className="text-sm font-semibold text-[#2B231B] mb-1">No Updates Checked Yet</h3>
                        <p className="text-xs text-[#8A7A6A] max-w-xs">Click &quot;Check for Updates&quot; to scan the MeitY portal for the latest regulatory changes.</p>
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-1">
                    <SchedulePanel />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Knowledge Sources Tab ───────────────────────────────── */}
          {activeTab === 'knowledge' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 pl-14 lg:pl-4 border-b border-[#DDD8D1] bg-[#EAE4DA]">
                <h2 className="text-lg font-semibold text-[#2B231B] font-serif">Knowledge Sources</h2>
                <p className="text-xs text-[#8A7A6A]">Upload and manage legal documents for the Knowledge Base</p>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-3xl mx-auto space-y-6">
                  {/* Legal Documents KB */}
                  <div className="border border-[#DDD8D1] rounded-lg bg-[#EAE4DA] shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-[#DDD8D1]">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#6B3A1B]/10 flex items-center justify-center flex-shrink-0">
                          <FiFileText className="w-5 h-5 text-[#6B3A1B]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-[#2B231B]">Legal Documents</h3>
                          <p className="text-xs text-[#8A7A6A]">DPDPA 2023, IT Act 2000, IT Act 2008 Amendment</p>
                        </div>
                        <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 flex-shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          Active
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <KnowledgeBaseUpload ragId={LEGAL_KB_RAG_ID} />
                    </div>
                  </div>

                  {/* MeitY Website Source */}
                  <div className="border border-[#DDD8D1] rounded-lg bg-[#EAE4DA] shadow-sm overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#AA8D19]/10 flex items-center justify-center flex-shrink-0">
                          <RiGovernmentLine className="w-5 h-5 text-[#AA8D19]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-[#2B231B]">MeitY Website</h3>
                          <p className="text-xs text-[#8A7A6A]">Ministry of Electronics & Information Technology portal</p>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 flex-shrink-0">
                          <FiRefreshCw className="w-3 h-3" />
                          Auto-synced
                        </span>
                      </div>
                      <div className="mt-3 p-3 rounded-lg bg-[#F3EFEA] border border-[#DDD8D1]">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <p className="text-xs text-[#8A7A6A]">Source URL</p>
                            <a href="https://www.meity.gov.in" target="_blank" rel="noopener noreferrer" className="text-sm text-[#6B3A1B] hover:text-[#AA8D19] font-medium inline-flex items-center gap-1">
                              meity.gov.in <FiExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-[#8A7A6A]">Schedule</p>
                            <p className="text-sm text-[#2B231B] font-medium">{cronToHuman('0 9 * * *')}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4 rounded-lg bg-[#F3EFEA] border border-[#DDD8D1]">
                    <div className="flex items-start gap-3">
                      <FiAlertCircle className="w-5 h-5 text-[#AA8D19] flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-semibold text-[#2B231B] mb-1">Supported File Types</h4>
                        <p className="text-xs text-[#8A7A6A] leading-relaxed">
                          Upload PDF, DOCX, or TXT files containing legal documents. The system will automatically process and index the content for the Legal Knowledge Assistant to reference when answering queries.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </InlineErrorBoundary>
  )
}
