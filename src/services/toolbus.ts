/**
 * ToolBus —— Agent 工具总线
 * 所有 app 贡献的 tools 汇总到这里，
 * 将来 agentic-core 的工具循环直接从这里拉。
 */
import type { ToolDefinition, ToolContext } from '@/types'

interface RegisteredTool {
  definition: ToolDefinition
  owner: string            // app id 或 'system'
}

class ToolBus {
  private tools = new Map<string, RegisteredTool>()

  register(definition: ToolDefinition, owner = 'system') {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool name conflict: ${definition.name}`)
    }
    this.tools.set(definition.name, { definition, owner })
  }

  unregister(name: string) {
    this.tools.delete(name)
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition)
  }

  async invoke(name: string, args: Record<string, unknown>, ctx: ToolContext = {}): Promise<unknown> {
    const t = this.tools.get(name)
    if (!t) throw new Error(`Unknown tool: ${name}`)
    return t.definition.execute(args, ctx)
  }
}

export const toolbus = new ToolBus()
