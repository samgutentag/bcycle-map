import systemsData from '../../systems.json'

export type SystemConfig = {
  system_id: string
  name: string
  gbfs_url: string
  version: string
}

const systems = systemsData as SystemConfig[]

export function getSystems(): SystemConfig[] {
  return systems
}

export function getSystem(systemId: string): SystemConfig | undefined {
  return systems.find(s => s.system_id === systemId)
}
