<!-- 通用 stat card（icon + label + big value + bar/trend/sublabel）-->
<script setup lang="ts">
defineProps<{
  icon?: string
  label: string
  value: string | number
  sublabel?: string
  tone?: 'default' | 'good' | 'warn' | 'danger' | 'accent'
  fullWidth?: boolean
}>()
</script>

<template>
  <div class="stat" :class="[tone || 'default', { full: fullWidth }]">
    <div class="head">
      <span v-if="icon" class="ic">{{ icon }}</span>
      <span class="lbl">{{ label }}</span>
    </div>
    <div class="val">{{ value }}</div>
    <div v-if="sublabel" class="sub">{{ sublabel }}</div>
    <div class="extra"><slot /></div>
  </div>
</template>

<style scoped>
.stat {
  background: var(--surface-2);
  border-radius: 8px;
  padding: 10px 12px 12px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.stat.full { grid-column: 1 / -1; }
.head { display: flex; align-items: center; gap: 6px; }
.ic { font-size: 14px; opacity: 0.8; }
.lbl { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.3px; text-transform: uppercase; }
.val {
  font-size: 20px; font-weight: 500; color: var(--fg-1); line-height: 1.2;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}
.sub { font-size: 11px; color: var(--fg-3); line-height: 1.3; }
.extra:empty { display: none; }
.extra { margin-top: 4px; }

.stat.good .val { color: #7ee6a6; }
.stat.warn .val { color: #f5c04a; }
.stat.danger .val { color: #f87171; }
.stat.accent .val { color: #9ecbff; }
</style>
