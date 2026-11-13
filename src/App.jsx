import React, { useState } from 'react'
import { fmtClock } from './data/network.js'
import { useWorld } from './store.jsx'
import { Btn, Tabs } from './ui/bits.jsx'
import ErrorBoundary from './ui/ErrorBoundary.jsx'
import TrainModal from './ui/TrainModal.jsx'
import GlobalSearch from './ui/GlobalSearch.jsx'
import Dashboard from './screens/Dashboard.jsx'
import NetworkConsole from './screens/NetworkConsole.jsx'
import SystemHealth from './screens/SystemHealth.jsx'
import Journey from './screens/Journey.jsx'

/*
  Four tabs, each with one job:
    Trains        — find a train, see its live prediction (click any row for detail)
    Network       — what is disrupting the network now, which lines, and by how much
    System health — is the prediction trustworthy right now, and is anything drifting?
    Integrations  — how another app would consume this
  Clicking a train never changes the tab — it opens the popup, from wherever you are.
*/
const TABS = [
  ['control', 'Trains'],
  ['ops',     'Network'],
  ['model',   'System health'],
  ['journey', 'Integrations'],
]

export default function App() {
  const { world, running, setRunning, reset, calib } = useWorld()
  const [tab, setTab] = useState('control')
  const [openId, setOpenId] = useState(null)

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-rulestrong bg-surface sticky top-0 z-30">
        <div className="max-w-[1680px] mx-auto px-4">
          <div className="flex items-center gap-4 py-2.5 flex-wrap">
            <div className="flex items-center gap-2.5 shrink-0">
              <span className={`w-1.5 h-4 ${running ? 'bg-signal pulse' : 'bg-inkfaint'}`} aria-hidden="true" />
              <div>
                <h1 className="lbl text-[13.5px] text-ink leading-none">Rail-ETA Intelligence</h1>
                <p className="text-[10px] text-inkfaint mt-1 leading-none">Prediction service · Mumbai division</p>
              </div>
            </div>

            <GlobalSearch world={world} onOpenTrain={setOpenId} />

            <div className="flex items-center gap-2.5 shrink-0 ml-auto">
              <div className="text-right leading-none">
                <div className="mono text-[20px] text-primary tnum leading-none">{fmtClock(world.nowSec)}</div>
                <div className="lbl text-[9px] text-inkfaint mt-1">network time</div>
              </div>
              <Btn onClick={() => setRunning(!running)} tone={running ? 'mute' : 'primary'}
                   title={running ? 'Pause the network' : 'Advance the network in real time'}>
                {running ? 'Pause' : 'Play'}
              </Btn>
              <Btn onClick={reset} title="Restart the simulation from the beginning">Reset</Btn>
            </div>
          </div>

          <Tabs tabs={TABS} value={tab} onChange={setTab} />
        </div>
      </header>

      <main className="flex-1 max-w-[1680px] w-full mx-auto px-4 py-4">
        <ErrorBoundary resetKey={tab}>
          {tab === 'control' && <Dashboard onOpenTrain={setOpenId} />}
          {tab === 'ops'     && <NetworkConsole onOpenTrain={setOpenId} />}
          {tab === 'model'   && <SystemHealth onOpenTrain={setOpenId} />}
          {tab === 'journey' && <Journey />}
        </ErrorBoundary>
      </main>

      <footer className="border-t border-rulestrong bg-surface mt-2">
        <div className="max-w-[1680px] mx-auto px-4 py-2.5 flex items-baseline gap-3 flex-wrap
                        text-[11px] text-inkfaint">
          <span className="lbl text-[10px] text-inksoft">Prototype</span>
          <span>
            Per-hop prediction heads · calibrated confidence windows · exact change attribution ·
            deterministic disruption simulator
          </span>
          <span className="ml-auto mono">SIH 2026 · PS 26028</span>
        </div>
      </footer>

      <TrainModal trainId={openId} world={world} calib={calib} onClose={() => setOpenId(null)} />
    </div>
  )
}
