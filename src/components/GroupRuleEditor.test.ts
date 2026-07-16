import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import en from '../locales/en'
import GroupRuleEditor from './GroupRuleEditor.vue'
import type { GroupRule, ProbeTarget } from '../api'

const member: ProbeTarget = {
  id: 'ping', group_id: 'group', kind: 'icmp', name: 'Internet', target: '1.1.1.1', params: {}, enabled: true,
}

const blankRule: GroupRule = {
  id: '', group_id: 'group', site_id: 'site_default', name: '', op: 'and', layer: 'internet', severity: 'warn',
  channel_ids: [], enabled: true, conditions: [],
}

function render(rule: GroupRule = blankRule, members: ProbeTarget[] = [member]) {
  return mount(GroupRuleEditor, {
    props: { rule, members, channels: [] },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
}

describe('GroupRuleEditor', () => {
  it('requires a name and emits a normalized one-level rule payload', async () => {
    const page = render()
    await page.get('button.btn-primary').trigger('click')
    expect(page.get('[role="alert"]').text()).toContain('name')
    expect(page.emitted('save')).toBeUndefined()

    await page.get('input.grule-name').setValue('  Internet loss  ')
    await page.get('input[type="radio"][value="or"]').setValue(true)
    await page.get('button.btn-primary').trigger('click')

    const saves = page.emitted('save')
    expect(saves).toHaveLength(1)
    expect(saves![0][0]).toEqual(expect.objectContaining({
      name: 'Internet loss', op: 'or', enabled: true,
      conditions: [expect.objectContaining({
        target_id: 'ping', metric_kind: 'probe.icmp.loss_pct', comparator: 'gte', threshold: 100, fail_threshold: 3,
      })],
    }))
  })

  it('does not invent a condition when the group has no targets', async () => {
    const page = render(blankRule, [])
    await page.get('input.grule-name').setValue('No targets')
    await page.get('button.btn-primary').trigger('click')
    expect(page.get('[role="alert"]').text()).toContain('condition')
    expect(page.emitted('save')).toBeUndefined()
  })
})
