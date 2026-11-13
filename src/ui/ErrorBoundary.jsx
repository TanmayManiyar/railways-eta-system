import React from 'react'

/** A failure on one screen should not blank the whole console mid-demo. */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="bg-surface border border-danger/40">
        <header className="px-3.5 py-2 bg-dangerwash border-b border-danger/30">
          <h2 className="lbl text-[11.5px] text-danger">This screen failed to render</h2>
        </header>
        <div className="p-3.5">
          <p className="text-[13px] text-inksoft">
            The rest of the console is unaffected — switch tabs and come back, or press Reset.
          </p>
          <pre className="mono text-[11px] text-inkfaint mt-2 overflow-x-auto">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
        </div>
      </section>
    )
  }
}
