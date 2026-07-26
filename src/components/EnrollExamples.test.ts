import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EnrollExamples from './EnrollExamples.vue'

function mountExamples() {
  return mount(EnrollExamples, {
    props: {
      serverUrl: "https://net'tact.example:12450",
      token: "to'ken",
    },
    global: {
      mocks: {
        $t: (key: string) => key,
      },
    },
  })
}

describe('EnrollExamples', () => {
  it('renders one-command installers for all four platforms', async () => {
    const wrapper = mountExamples()

    expect(wrapper.find('pre').text()).toContain('https://d.nettact.org/agent/install.ps1')
    expect(wrapper.find('pre').text()).toContain("-ServerUrl 'https://net''tact.example:12450'")
    expect(wrapper.find('pre').text()).toContain('-AutoUpdate')

    await wrapper.findAll('.tab')[1].trigger('click')
    expect(wrapper.find('pre').text()).toContain('install.sh | sudo bash')
    expect(wrapper.find('pre').text()).toContain(`--token 'to'"'"'ken' --auto-update`)

    await wrapper.findAll('.tab')[2].trigger('click')
    expect(wrapper.find('pre').text()).toContain('install.sh | sudo bash')

    await wrapper.findAll('.tab')[3].trigger('click')
    expect(wrapper.find('pre').text()).toContain('https://d.nettact.org/agent/install.sh')
    expect(wrapper.find('pre').text()).toContain('--docker')
  })

  it('removes the automatic-update flag when the option is disabled', async () => {
    const wrapper = mountExamples()
    await wrapper.find<HTMLInputElement>('.auto-update input').setValue(false)
    expect(wrapper.find('pre').text()).not.toContain('-AutoUpdate')

    await wrapper.findAll('.tab')[3].trigger('click')
    expect(wrapper.find('pre').text()).not.toContain('--auto-update')
  })
})
