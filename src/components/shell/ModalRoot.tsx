import { useUIStore } from '@/store'
import { NewProjectWizard } from '@/components/dashboard/NewProjectWizard'
import { MasterIntakeWizard } from '@/components/dashboard/MasterIntakeWizard'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { PreFlightModal } from '@/components/diagnostics/PreFlightModal'
import { ModifyModal } from '@/components/modify/ModifyModal'
import { ExportProjectModal } from '@/components/dialog/ExportProjectModal'
import { ExportScriptModal } from '@/components/dialog/ExportScriptModal'

export function ModalRoot() {
  const kind = useUIStore(s => s.modal.kind)
  const close = useUIStore(s => s.closeModal)
  if (!kind) return null

  let content: React.ReactNode = null
  if (kind === 'new_project')   content = <NewProjectWizard onClose={close} />
  if (kind === 'intake')        content = <MasterIntakeWizard onClose={close} />
  if (kind === 'settings')      content = <SettingsModal onClose={close} />
  if (kind === 'pre_flight')    content = <PreFlightModal onClose={close} />
  if (kind === 'modify')        content = <ModifyModal onClose={close} />
  if (kind === 'export')        content = <ExportProjectModal />
  if (kind === 'export_script') content = <ExportScriptModal />

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={close}
    >
      <div onClick={(e) => e.stopPropagation()}>{content}</div>
    </div>
  )
}
