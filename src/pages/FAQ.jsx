import { useState, useEffect } from 'react'
import { useTranslation } from '../lib/i18n'

const FAQ_DATA = {
  access: {
    en: {
      label: 'Users & Access',
      items: [
        {
          q: 'How does access work?',
          a: 'Two ways. Invite code: receive a code from the admin, enter it when registering — you get immediate access with your tier pre-assigned. Self-register: create an account without a code and wait for the admin\'s approval. Your tier is assigned by the admin when approved.',
        },
        {
          q: 'I registered but can\'t access the app — what happened?',
          a: 'Your account is pending approval. The admin reviews registrations and will approve and assign your tier. You will get an email notification. If waiting more than 24 hours, contact the admin directly.',
        },
        {
          q: 'What are the user tiers?',
          a: 'Four tiers — Admin (reserved for the admin, full control), Ultra (unlimited AI access), Power (50 credits/month = 10 AI analyses), Standard (20 credits/month = 4 AI analyses). Your tier is shown in the Settings page.',
          table: {
            headers: ['Feature', 'Power (50 credits)', 'Standard (20 credits)'],
            rows: [
              ['AI analysis (Run All Roles)', '5 credits each', '5 credits each'],
              ['Monthly analyses', '10 matches', '4 matches'],
              ['Model performance page', '✓', '✗'],
              ['All analysis tabs', '✓', '✓'],
              ['My Bets (private)', '✓', '✓'],
              ['Tips & recommendations', '✓', '✓'],
            ],
          },
        },
        {
          id: 'credits',
          q: 'What is a credit and how is it used?',
          a: 'Credits are consumed when you run the AI analysis (the "Run All Roles" button on any match). Each full analysis costs 5 credits — this runs all 11 AI roles and generates the composite confidence score. Everything else (Poisson matrix, odds calculator, stats, bets) is free and unlimited.',
        },
        {
          q: 'Can other users see my bets?',
          a: 'No. Your betting data is completely private, isolated at the database level using Row Level Security. No other user — including the admin — can see your individual bets, stakes, or P&L.',
        },
        {
          q: 'What happens when my credits run out?',
          a: 'All features remain available except AI analysis. The Poisson matrix, stats tabs, odds calculator, and bet tracking are always free. Credits reset on the 1st of each month. You can ask the admin for a top-up if needed.',
        },
        {
          q: 'Can I get my tier upgraded?',
          a: 'Yes — contact the admin directly. Upgrades are at the admin\'s discretion.',
        },
      ],
    },
    zh: {
      label: '用户与访问',
      items: [
        {
          q: '如何获得访问权限？',
          a: '两种方式。邀请码：从管理员处获得邀请码，注册时填入，即刻获得预设级别的访问权限。自行注册：无需邀请码创建账户，等待管理员审批，审批时分配级别。',
        },
        {
          q: '我注册了但无法访问应用，怎么回事？',
          a: '您的账户正在等待审批。管理员会审核新注册并分配级别，审批后您将收到邮件通知。如等待超过24小时，请直接联系管理员。',
        },
        {
          q: '用户级别有哪些？',
          a: '四个级别：Admin（管理员专属，完全控制权）、Ultra（无限 AI 访问）、Power（每月50额度 = 10次 AI 分析）、Standard（每月20额度 = 4次 AI 分析）。您的级别显示在设置页面。',
          table: {
            headers: ['功能', 'Power（50额度）', 'Standard（20额度）'],
            rows: [
              ['AI 分析（运行所有角色）', '每次5额度', '每次5额度'],
              ['每月可分析场次', '10场', '4场'],
              ['模型表现页面', '✓', '✗'],
              ['所有分析标签', '✓', '✓'],
              ['我的投注（私密）', '✓', '✓'],
              ['精选推荐', '✓', '✓'],
            ],
          },
        },
        {
          id: 'credits',
          q: '什么是额度，如何使用？',
          a: '运行 AI 分析时消耗额度（任意赛事页面的"运行所有角色"按钮）。每次完整分析消耗5额度——运行全部11个 AI 角色并生成综合置信度评分。其他所有功能（泊松矩阵、赔率计算器、数据统计、投注记录）均免费无限使用。',
        },
        {
          q: '其他用户能看到我的投注吗？',
          a: '不能。您的投注数据完全私密，通过数据库级别的行级安全策略（RLS）隔离。任何其他用户（包括管理员）都无法查看您的个人投注、金额或盈亏。',
        },
        {
          q: '额度用完后怎么办？',
          a: '除 AI 分析外，所有功能仍可使用。泊松矩阵、数据标签、赔率计算器和投注记录始终免费。额度每月1日重置。如有需要，可向管理员申请补充额度。',
        },
        {
          q: '我能升级级别吗？',
          a: '可以——直接联系管理员。升级由管理员自行决定。',
        },
      ],
    },
  },
  model: {
    en: {
      label: 'Prediction Model',
      items: [
        {
          q: 'How accurate is the model?',
          a: 'The model combines Poisson distribution, form analysis, and 11 AI specialist roles. In backtesting across 2022 WC matches, the composite confidence score correctly identified the outcome in ~68% of cases where confidence exceeded 70. Results improve as more live match data accumulates during the tournament.',
        },
        {
          q: 'What data does the model use?',
          a: 'Goals scored and conceded per game (overall, home, away), expected goals (xGF/xGA) where available, recent form string (last 5 matches), WC-specific match count, and contextual factors like stage of tournament and rest days.',
        },
        {
          q: 'What is the Poisson matrix?',
          a: 'Poisson is a statistical method that models goal-scoring as a random process. Given each team\'s attack and defence strength, it predicts the probability of every possible scoreline (0–0 to 4–4+). The matrix displays these probabilities as a colour heatmap — darker cells indicate a higher likelihood.',
        },
        {
          q: 'Why does V2 differ from V1?',
          a: 'V1 uses overall (home+away combined) stats. V2 applies an away-factor correction: away teams historically score 10–15% fewer goals and concede more. V2 is generally more accurate for WC matches played at neutral venues where travel and atmosphere affect performance.',
        },
        {
          q: 'Why does confidence sometimes drop after running AI roles?',
          a: 'The 11 AI roles apply calibration multipliers based on historical accuracy (the learning loop). If a role\'s past predictions in similar contexts were weak, its weight is reduced. The composite scorer synthesises all roles and may produce a lower final score than any individual role suggests.',
        },
      ],
    },
    zh: {
      label: '预测模型',
      items: [
        {
          q: '模型准确率如何？',
          a: '模型结合了泊松分布、形态分析和11个 AI 专家角色。在对2022年世界杯赛事的回测中，综合置信度超过70时，模型正确识别结果的概率约为68%。随着锦标赛期间积累更多实时数据，结果会不断改善。',
        },
        {
          q: '模型使用哪些数据？',
          a: '每场比赛的进球数和失球数（整体、主场、客场）、预期进球数（xGF/xGA，如有数据）、近期形态字符串（最近5场）、世界杯专项比赛场次，以及赛事阶段和休息天数等背景因素。',
        },
        {
          q: '什么是泊松矩阵？',
          a: '泊松是一种将进球建模为随机过程的统计方法。根据每支球队的攻防实力，它预测每种可能比分（0-0到4-4+）的概率。矩阵以颜色热图显示这些概率——颜色越深表示可能性越高。',
        },
        {
          q: 'V2 与 V1 有何不同？',
          a: 'V1 使用整体（主客场合计）数据。V2 应用了客场系数修正：历史上客队进球少约10-15%，失球更多。对于在中立场地举行的世界杯赛事，V2 通常更准确，因为旅途和氛围会影响表现。',
        },
        {
          q: '为什么运行 AI 角色后置信度有时会下降？',
          a: '11个 AI 角色根据历史准确率（学习循环）应用校准乘数。如果某角色在类似情境下的历史预测较弱，其权重会降低。综合评分者汇总所有角色输出，最终得分可能低于任何单个角色的建议值。',
        },
      ],
    },
  },
  betting: {
    en: {
      label: 'Betting',
      items: [
        {
          q: 'What is Expected Value (EV)?',
          a: 'EV = (probability × decimal odds) − 1. Positive EV means the bet is mathematically worth placing over many trials. Example: if our model gives 55% win probability and odds are 2.10 → EV = (0.55 × 2.10) − 1 = +15.5% edge. Metis only recommends bets with EV > 5%.',
        },
        {
          q: 'What is the Kelly criterion?',
          a: 'Kelly calculates the optimal fraction of bankroll to bet: f = (bp − q) / b, where b = net odds, p = win probability, q = loss probability. Metis applies a half-Kelly or quarter-Kelly for safety, since model probabilities are estimates rather than certainties.',
        },
        {
          q: 'What is Asian handicap?',
          a: 'Asian handicap eliminates the draw as an outcome by giving one team a virtual head start. E.g., Home −0.5 means home team must win outright; Home −1.5 means home team must win by 2+. Half-goal handicaps prevent pushes (tied positions where stake is refunded).',
        },
        {
          q: 'Why can\'t I see AI analysis on some matches?',
          a: 'AI analysis only runs when you click "Run All Roles". It requires team stats to be loaded first. If a match has no stats, fetch them via the Stats tab. Older completed matches may not have stats available from the API.',
        },
        {
          q: 'How do I use the Tips page?',
          a: 'The Tips page shows recommended bets where the model finds positive expected value. Use it for a quick overview of the best opportunities across all matches. Click any match card to open the full analysis.',
        },
        {
          q: 'Should I follow every recommendation?',
          a: 'No. Metis is a tool to enhance your decision-making, not replace it. Always apply your own judgement. Never bet more than you can afford to lose. The model has known limitations: limited data for smaller nations, xG unavailable for international matches, and past performance does not guarantee future results.',
        },
      ],
    },
    zh: {
      label: '投注',
      items: [
        {
          q: '什么是期望值（EV）？',
          a: 'EV =（概率 × 小数赔率）− 1。正期望值意味着从长期来看这注投注在数学上值得下。例如：如果模型给出55%的胜率，赔率为2.10，则 EV = (0.55 × 2.10) − 1 = +15.5%优势。Metis 只推荐 EV > 5% 的投注。',
        },
        {
          q: '什么是凯利公式？',
          a: '凯利公式计算最优投注比例：f = (bp − q) / b，其中 b = 净赔率，p = 胜率，q = 败率。由于模型概率是估计值而非确定数字，Metis 采用半凯利或四分之一凯利以确保安全。',
        },
        {
          q: '什么是亚盘？',
          a: '亚盘通过给一队虚拟让分来消除平局结果。例如：主队 -0.5 表示主队必须获胜；主队 -1.5 表示主队必须赢2球以上。半球让分可防止平局（退还本金）。',
        },
        {
          q: '为什么某些赛事看不到 AI 分析？',
          a: 'AI 分析只在您点击"运行所有角色"时运行。运行前需要先加载球队数据。如果赛事还没有数据，请通过数据标签获取。较早的已完成赛事可能无法从 API 获取数据。',
        },
        {
          q: '如何使用精选页面？',
          a: '精选页面显示模型认为具有正期望值的推荐投注，可快速浏览所有赛事中的最佳机会。点击任意赛事卡片可打开完整分析。',
        },
        {
          q: '我是否应该遵循每项推荐？',
          a: '不必。Metis 是辅助您决策的工具，而不是替代您判断的系统。请始终运用自己的判断力。永远不要投注超出承受能力的金额。模型存在已知局限性：小国数据有限、国际赛事不支持 xG 数据，且过去的表现不代表未来结果。',
        },
      ],
    },
  },
  ai: {
    en: {
      label: 'AI Roles',
      items: [
        {
          q: 'What are the 11 AI roles?',
          a: 'Role 1 (Data Quality), Role 2 (Form Analyst), Role 3 (Deep Analysis — Sonnet), Role 4 (Context Analyst), Role 5 (Market Intelligence), Role 6 (Risk Manager), Role 7 (Tactical Analyst), Role 8 (H2H Historian), Role 9 (Motivation Scorer), Role 10 (Composite Scorer). Role 11 runs post-settlement to calibrate model accuracy.',
        },
        {
          q: 'Which AI model runs each role?',
          a: 'Roles 1, 2, 4–10 use Claude Haiku (fast, efficient). Role 3 (Deep Analysis) uses Claude Sonnet (higher reasoning quality). Role 3 synthesises all Phase 1 outputs. Role 10 combines everything into a final composite confidence score.',
        },
        {
          q: 'What is the Composite Scorer (Role 10)?',
          a: 'Role 10 is the final arbiter. It weights: Data Quality (25%), Form (20%), Context + Motivation (20%), Risk (20%), Tactical + H2H (15%). The output is the composite confidence score (0–100) and the consensus bet recommendation.',
        },
        {
          q: 'Why do some roles show a parse error?',
          a: 'Occasionally a Claude API response is malformed or truncated. The system attempts to salvage key fields via regex fallback. If salvage fails, the role shows a parse_error flag. This is rare and typically resolves by re-running the analysis.',
        },
        {
          q: 'How does the learning loop work?',
          a: 'After every match settles, Role 11 compares each role\'s prediction to the actual outcome. If a role consistently overestimates confidence, its calibration multiplier is reduced. Over time, each role is weighted by its historical hit rate in similar match contexts.',
        },
        {
          q: 'Can I run individual roles?',
          a: 'No — the system always runs all 11 roles together. This ensures Role 3 (Deep Analysis) and Role 10 (Composite Scorer) receive the complete set of inputs. Individual role outputs are visible in the AI Roles tab after the run completes.',
        },
      ],
    },
    zh: {
      label: 'AI 角色',
      items: [
        {
          q: '11个 AI 角色是什么？',
          a: '角色1（数据质量）、角色2（形态分析师）、角色3（深度分析——Sonnet）、角色4（背景分析师）、角色5（市场情报）、角色6（风险管理师）、角色7（战术分析师）、角色8（历史对阵专家）、角色9（动力评分员）、角色10（综合评分员）。角色11在赛事结算后运行，用于校准模型准确率。',
        },
        {
          q: '每个角色使用哪种 AI 模型？',
          a: '角色1、2、4–10 使用 Claude Haiku（快速高效）。角色3（深度分析）使用 Claude Sonnet（推理能力更强）。角色3综合所有第一阶段输出，角色10将所有结果合并为最终综合置信度评分。',
        },
        {
          q: '综合评分员（角色10）是什么？',
          a: '角色10是最终裁决者。权重分配：数据质量25%、形态20%、背景+动力20%、风险20%、战术+历史对阵15%。输出为综合置信度评分（0–100）和共识投注推荐。',
        },
        {
          q: '为什么某些角色显示解析错误？',
          a: '偶尔 Claude API 响应格式异常或被截断。系统会尝试通过正则表达式回退机制抢救关键字段。如果抢救失败，该角色会显示 parse_error 标志。这种情况很罕见，通常重新运行分析即可解决。',
        },
        {
          q: '学习循环是如何工作的？',
          a: '每场赛事结算后，角色11将每个角色的预测与实际结果对比。如果某角色持续高估置信度，其校准乘数会降低。随着时间推移，每个角色根据其在类似赛事中的历史命中率进行权重调整。',
        },
        {
          q: '我能单独运行某个角色吗？',
          a: '不能——系统始终同时运行全部11个角色。这确保角色3（深度分析）和角色10（综合评分员）能获得完整的输入集。所有角色的输出在分析运行完成后可在 AI 角色标签中查看。',
        },
      ],
    },
  },
  app: {
    en: {
      label: 'App & Data',
      items: [
        {
          q: 'Is my data backed up?',
          a: 'Yes. All data is stored in Supabase (PostgreSQL), which maintains continuous point-in-time backups. Your bets, stats, and analysis history are persisted indefinitely and are not affected by app updates.',
        },
        {
          q: 'Does Metis work on mobile?',
          a: 'Yes. The app is fully responsive with a mobile-optimised bottom navigation bar. The AI analysis tabs and Poisson matrix are designed for both mobile and desktop. For detailed grid analysis, desktop is recommended.',
        },
        {
          q: 'How current is the match data?',
          a: 'Match fixtures are seeded and updated manually before each matchday. Team stats are fetched from the football API on-demand when you click "Fetch Stats" — they reflect the team\'s form at that point in time. Each stat row is timestamped so you know when it was last refreshed.',
        },
        {
          q: 'Can I export my betting history?',
          a: 'Not currently. The My Bets page shows your full history with P&L, ROI, and win rate. Export functionality may be added in a future update.',
        },
        {
          q: 'Why does the app require login?',
          a: 'Metis is a private tool for a small group of users. All data is user-isolated at the database level using Row Level Security (RLS). Your bets and analysis are completely private — not even the admin can see them.',
        },
      ],
    },
    zh: {
      label: '应用与数据',
      items: [
        {
          q: '我的数据有备份吗？',
          a: '有。所有数据存储在 Supabase（PostgreSQL）中，该平台维护持续的时间点备份。您的投注、数据统计和分析历史将无限期保存，且不受应用更新影响。',
        },
        {
          q: 'Metis 支持移动设备吗？',
          a: '支持。应用完全响应式设计，带有移动优化的底部导航栏。AI 分析标签和泊松矩阵均适配移动端和桌面端。对于详细的网格分析，建议使用桌面端。',
        },
        {
          q: '赛事数据有多新？',
          a: '赛事赛程在每个比赛日前手动更新。球队数据在您点击"获取数据"时按需从足球 API 获取，反映该时间点的球队状态。每条数据行都有时间戳，您可以知道上次刷新的时间。',
        },
        {
          q: '我能导出我的投注记录吗？',
          a: '目前还不能。我的投注页面显示您的完整历史记录，包括盈亏、回报率和胜率。导出功能可能在未来版本中添加。',
        },
        {
          q: '为什么应用需要登录？',
          a: 'Metis 是面向少数用户的私人工具。所有数据通过行级安全策略（RLS）在数据库级别进行用户隔离。您的投注和分析完全私密——即使是管理员也无法查看。',
        },
      ],
    },
  },
}

const CATEGORY_KEYS = ['access', 'model', 'betting', 'ai', 'app']

function AccordionItem({ item, lang, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      <button
        id={item.id ? `faq-${item.id}` : undefined}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left',
          padding: '16px 0',
          background: 'none', border: 'none',
          cursor: 'pointer',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          fontFamily: 'var(--font-ui)',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
          {item.q}
        </span>
        <span style={{
          fontSize: 20, color: 'var(--color-text-muted)', flexShrink: 0, marginTop: 2,
          transition: 'transform 0.2s',
          display: 'inline-block',
          transform: open ? 'rotate(45deg)' : 'none',
        }}>
          +
        </span>
      </button>
      {open && (
        <div style={{ paddingBottom: 18 }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.65, marginBottom: item.table ? 14 : 0 }}>
            {item.a}
          </p>
          {item.table && (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    {item.table.headers.map((h, i) => (
                      <th key={i} style={{
                        textAlign: 'left', padding: '8px 12px',
                        background: 'var(--color-bg-secondary)',
                        fontWeight: 700, color: 'var(--color-text-secondary)',
                        borderBottom: '2px solid var(--color-border)',
                        whiteSpace: 'nowrap',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {item.table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--color-border-light)',
                          color: cell === '✓'
                            ? 'var(--color-success)'
                            : cell === '✗'
                              ? 'var(--color-danger)'
                              : 'var(--color-text-primary)',
                          fontWeight: ci === 0 ? 500 : 400,
                        }}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function FAQ() {
  const { t, lang } = useTranslation()
  const [activeTab, setActiveTab] = useState('all')

  // Scroll to #credits anchor on mount
  useEffect(() => {
    const hash = window.location.hash
    if (hash === '#credits') {
      setTimeout(() => {
        const el = document.getElementById('faq-credits')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
    }
  }, [])

  const tabs = [
    { key: 'all', label: lang === 'en' ? 'All' : '全部' },
    ...CATEGORY_KEYS.map(k => ({ key: k, label: FAQ_DATA[k][lang].label })),
  ]

  const visibleCategories = activeTab === 'all' ? CATEGORY_KEYS : [activeTab]

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 48px' }}>
      <h1 style={{
        fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800,
        color: 'var(--color-text-primary)', marginBottom: 8,
      }}>
        {t('faq.title')}
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 28 }}>
        {lang === 'en' ? 'World Cup 2026 · Metis betting intelligence' : 'World Cup 2026 · Metis 投注智能'}
      </p>

      {/* Topic tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 32 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'var(--font-ui)',
              borderRadius: 'var(--radius-sm)',
              background: activeTab === tab.key ? 'var(--color-accent)' : 'var(--color-bg-card)',
              color: activeTab === tab.key ? '#000' : 'var(--color-text-secondary)',
              border: activeTab === tab.key ? 'none' : '1px solid var(--color-border)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {visibleCategories.map((catKey, ci) => (
        <div key={catKey} style={{ marginBottom: 40 }}>
          {activeTab === 'all' && (
            <h2 style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              color: 'var(--color-text-muted)', textTransform: 'uppercase',
              marginBottom: 2, paddingBottom: 6,
              borderBottom: '2px solid var(--color-accent-border)',
              display: 'inline-block',
            }}>
              {FAQ_DATA[catKey][lang].label}
            </h2>
          )}
          {FAQ_DATA[catKey][lang].items.map((item, i) => (
            <AccordionItem
              key={i}
              item={item}
              lang={lang}
              defaultOpen={ci === 0 && i === 0}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
