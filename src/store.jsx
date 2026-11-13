import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calibrate } from './engine/calibrate.js'
import { initWorld, tickWorld, declareEvent, clearEvent, SIM_START } from './engine/world.js'

const Ctx = createContext(null)
export const useWorld = () => useContext(Ctx)

const TICK_MS = 700
const TICK_SEC = 30            // network seconds advanced per tick while playing

export function WorldProvider({ children }) {
  const evalRef = useRef(null)
  if (!evalRef.current) evalRef.current = calibrate()

  const worldRef = useRef(null)
  if (!worldRef.current) worldRef.current = initWorld(evalRef.current.calib)

  const [version, setVersion] = useState(0)
  const [running, setRunning] = useState(false)
  const [lastImpact, setLastImpact] = useState(null)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      tickWorld(worldRef.current, TICK_SEC, evalRef.current.calib)
      bump()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [running, bump])

  const addEvent = useCallback((spec) => {
    const res = declareEvent(worldRef.current, spec, evalRef.current.calib)
    setLastImpact(res)
    bump()
    return res
  }, [bump])

  const removeEvent = useCallback((id) => {
    clearEvent(worldRef.current, id, evalRef.current.calib)
    bump()
  }, [bump])

  const reset = useCallback(() => {
    worldRef.current = initWorld(evalRef.current.calib)
    setLastImpact(null)
    setRunning(false)
    bump()
  }, [bump])

  const value = useMemo(() => ({
    world: worldRef.current,
    calib: evalRef.current.calib,
    evaluation: evalRef.current,
    version, running, setRunning,
    addEvent, removeEvent, reset,
    lastImpact, setLastImpact,
    simStart: SIM_START,
  }), [version, running, addEvent, removeEvent, reset, lastImpact])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
