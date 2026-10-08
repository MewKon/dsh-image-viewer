/**
 * Client-half tests.
 *
 * There is no browser here, so these do the two things a browser would tell us
 * and nothing more:
 *
 *   1. Load the real built bundle through a stand-in `__ModuleLoader__`, with a
 *      `require` that answers ONLY `react`. That is the substantive check — the
 *      bundle declares no `dsh.client.external`, so any other request would
 *      throw in the page, and a `require` generous enough to answer everything
 *      would hide exactly the failure worth catching.
 *   2. Call the plugin's `apply` and its card component directly. `apply` is
 *      asserted against the three seats it must claim; the card is asserted
 *      against the argument shapes it must survive, and its expand toggle is
 *      driven for real through the click handler it wires.
 *
 * The React stand-in keeps hook state across renders and resets the hook cursor
 * per render, so "click the thumbnail, render again" is a real assertion rather
 * than a stub that can only ever see the initial state. It runs no effects and
 * touches no DOM.
 *
 * What this deliberately does NOT cover: layout, CSS, and anything that exists
 * only once React actually mounts the tree. Run `npm run build` first.
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

/** Hook slots for the component currently being rendered. */
let hookCursor = 0
/** Persisted hook values, by slot index, across renders of one component. */
let hookSlots = []

/** A minimal, stateful React stand-in that records the element tree it builds. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    const slot = hookCursor++
    if (!(slot in hookSlots)) hookSlots[slot] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      hookSlots[slot] = typeof next === 'function' ? next(hookSlots[slot]) : next
    }
    return [hookSlots[slot], set]
  },
  useEffect() {
    hookCursor += 1
  },
  useCallback(callback) {
    hookCursor += 1
    return callback
  },
}

/**
 * Drop every persisted hook value, so each test starts from a fresh mount.
 */
function resetHooks() {
  hookCursor = 0
  hookSlots = []
}

/**
 * Render one component, reusing the hook slots of the previous render — the
 * same identity React would keep for a mounted component.
 * @param component - the component function to call.
 * @param props - its props.
 * @returns the stubbed element tree.
 */
function render(component, props) {
  hookCursor = 0
  return component(props)
}

/** Capture the bundle's factory when the bundle registers itself. */
let definition
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
}

await import('../lib/client.js')

assert.equal(typeof definition, 'object', 'the bundle did not call window.__ModuleLoader__.load')
assert.equal(definition.id, 'dsh-image-viewer', 'the bundle id must equal the package name the host resolves')

/** Module requests the bundle actually makes, in order. */
const requests = []
const plugin = definition.factory((name) => {
  requests.push(name)
  if (name === 'react') return React
  throw new Error(`unexpected module request: ${name}`)
})

/**
 * Collect every element of one type from a stubbed element tree.
 * @param node - the element (or child value) to walk.
 * @param type - the string tag to collect.
 * @returns the matching elements in document order.
 */
function findAll(node, type) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type))
  const own = node.type === type ? [node] : []
  return [...own, ...node.children.flatMap((child) => findAll(child, type))]
}

/**
 * Every string of text under one element, concatenated.
 * @param node - the element (or child value) to walk.
 * @returns the visible text.
 */
function textOf(node) {
  if (typeof node === 'string') return node
  if (node === null || node === undefined || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return node.children.map(textOf).join('')
}

/**
 * URL the host half would serve one path from, as the card should encode it.
 * @param path - a `/`-separated absolute path.
 * @returns the encoded route URL.
 */
function expectedUrl(path) {
  return '/image-viewer/file?p=' + encodeURIComponent(path)
}

describe('bundle contract', () => {
  it('is self-contained: react is the only module it requests', () => {
    assert.deepEqual(requests, ['react'])
  })

  it('declares the slots service as its hard dependency', () => {
    assert.deepEqual(plugin.inject, ['slots'])
  })

  it('exports apply plus the components it renders', () => {
    for (const name of ['apply', 'Drawer', 'Lightbox', 'ReadImageCard', 'SidebarToggle']) {
      assert.equal(typeof plugin[name], 'function', `${name} is not exported as a function`)
    }
  })
})

describe('apply', () => {
  /** Run `apply` against a recording stub of the client context. */
  function runApply() {
    const injected = []
    const registrations = []
    const effects = []
    const ctx = {
      effect(callback) {
        effects.push(callback())
      },
      slots: {
        inject(key, callback) {
          injected.push(key)
          return callback()
        },
        register(options, component) {
          registrations.push({ options, component })
          return () => {}
        },
      },
    }
    plugin.apply(ctx)
    return { injected, registrations, effects }
  }

  it('waits for exactly the three seats it claims', () => {
    const { injected } = runApply()
    assert.deepEqual(injected, ['tool.call.toolview', 'sidebar.footer.action', 'shell.overlay'])
  })

  it('claims read_image by key and renders a function in each seat', () => {
    const { registrations } = runApply()
    assert.equal(registrations.length, 3)
    assert.deepEqual(registrations[0].options, { name: 'tool.call.toolview', key: 'read_image' })
    assert.equal(registrations[1].options.name, 'sidebar.footer.action')
    assert.equal(registrations[2].options.name, 'shell.overlay')
    for (const registration of registrations) {
      assert.equal(typeof registration.component, 'function')
    }
  })

  it('uses one fresh id of its own in both list seats', () => {
    const { registrations } = runApply()
    for (const index of [1, 2]) {
      assert.equal(registrations[index].options.id, 'dsh-image-viewer')
    }
  })

  it('registers a disposer for its stylesheet', () => {
    const { effects } = runApply()
    assert.equal(effects.length, 1)
    assert.equal(typeof effects[0], 'function')
  })
})

describe('ReadImageCard', () => {
  const card = plugin.ReadImageCard

  beforeEach(() => {
    resetHooks()
  })

  /** Props for one call whose only argument is `file_path`. */
  function propsFor(filePath, extra = {}) {
    return {
      callId: 'c1',
      toolName: 'read_image',
      cwd: 'D:\\work',
      block: { callId: 'c1', name: 'read_image', argsRaw: JSON.stringify({ file_path: filePath }) },
      ...extra,
    }
  }

  it('renders a running call from its raw argument JSON', () => {
    const tree = render(card, propsFor('docs/a.png'))
    const images = findAll(tree, 'img')
    assert.equal(images.length, 1, 'collapsed shows the thumbnail only')
    assert.equal(images[0].props.src, expectedUrl('D:/work/docs/a.png'))
  })

  it('always names the tool and its state, so the call stays identifiable', () => {
    const running = render(card, propsFor('hero.png'))
    const tool = findAll(running, 'span').find((node) => node.props.className === 'diw-cardTool')
    assert.equal(textOf(tool), 'read_image', 'the card does not say which tool ran')
    const state = findAll(running, 'span').find((node) => node.props.className === 'diw-cardState')
    assert.equal(textOf(state), '运行中')
    assert.equal(state.props['data-state'], 'running')

    const settled = render(card, {
      callId: 'c8',
      toolName: 'read_image',
      cwd: 'D:\\work',
      block: {
        kind: 'tool-result',
        callId: 'c8',
        call: { name: 'read_image', argsRaw: '{"file_path":"hero.png"}' },
        isError: false,
      },
    })
    assert.equal(textOf(findAll(settled, 'span').find((n) => n.props.className === 'diw-cardState')), '已完成')

    // The degraded paths keep the header too: a card without it reads as an
    // attached image rather than a tool call.
    for (const brokenProps of [
      { callId: 'c9', toolName: 'read_image', block: { argsRaw: '{}' } },
      propsFor('.dsh/attachments/ab12cd'),
    ]) {
      const degraded = render(card, brokenProps)
      assert.equal(textOf(findAll(degraded, 'span').find((n) => n.props.className === 'diw-cardTool')), 'read_image')
    }
  })

  it('renders a settled call from its backfilled call head', () => {
    const tree = render(card, {
      callId: 'c2',
      toolName: 'read_image',
      cwd: 'D:\\work',
      block: {
        kind: 'tool-result',
        callId: 'c2',
        call: { name: 'read_image', argsRaw: '{"file_path":"D:\\\\pics\\\\b.jpg"}' },
        isError: false,
      },
    })
    assert.equal(findAll(tree, 'img')[0].props.src, expectedUrl('D:/pics/b.jpg'))
  })

  it('resolves a workspace-relative path against cwd with one separator spelling', () => {
    const tree = render(card, propsFor('nested/deep/c.webp'))
    assert.equal(findAll(tree, 'img')[0].props.src, expectedUrl('D:/work/nested/deep/c.webp'))
  })

  it('expands to the original on click and collapses again', () => {
    const first = render(card, propsFor('hero.png'))
    assert.equal(findAll(first, 'img').length, 1)

    const thumbnail = findAll(first, 'button').find((node) => node.props.className === 'diw-cardThumb')
    assert.equal(typeof thumbnail.props.onClick, 'function', 'the thumbnail is not clickable')
    thumbnail.props.onClick()

    const expanded = render(card, propsFor('hero.png'))
    const images = findAll(expanded, 'img')
    assert.equal(images.length, 2, 'expanded shows the thumbnail and the original')
    assert.equal(images[1].props.className, 'diw-cardOpen')
    assert.equal(images[1].props.src, expectedUrl('D:/work/hero.png'))

    images[1].props.onClick()
    assert.equal(findAll(render(card, propsFor('hero.png')), 'img').length, 1, 'clicking the original did not collapse it')
  })

  it('shows the file name and offers an open-in-new-tab link', () => {
    const tree = render(card, propsFor('a/hero.png'))
    assert.match(textOf(tree), /hero\.png/)
    const link = findAll(tree, 'a')[0]
    assert.equal(link.props.href, expectedUrl('D:/work/a/hero.png'))
    assert.equal(link.props.target, '_blank')
    assert.equal(textOf(link), '查看')
  })

  it('shows the duration once the call settled', () => {
    const tree = render(card, {
      callId: 'c10',
      toolName: 'read_image',
      cwd: 'D:\\work',
      block: {
        kind: 'tool-result',
        callId: 'c10',
        call: { name: 'read_image', argsRaw: '{"file_path":"hero.png"}' },
        callTime: 1_000,
        time: 1_250,
        content: [],
        isError: false,
      },
    })
    const duration = findAll(tree, 'span').find((node) => node.props.className === 'diw-cardDuration')
    assert.equal(textOf(duration), '250 ms')
  })

  it('reports no duration while the call is still running', () => {
    const tree = render(card, propsFor('hero.png'))
    assert.equal(
      findAll(tree, 'span').some((node) => node.props.className === 'diw-cardDuration'),
      false,
      'a running call has no settled duration to report',
    )
  })

  it('expands the argument and result JSON behind the details toggle', () => {
    const props = {
      callId: 'c11',
      toolName: 'read_image',
      cwd: 'D:\\work',
      block: {
        kind: 'tool-result',
        callId: 'c11',
        call: { name: 'read_image', argsRaw: '{"file_path":"hero.png"}' },
        callTime: 0,
        time: 1_500,
        content: [
          { type: 'text', text: '图片已读取' },
          { type: 'image', attachment: { attachmentId: 'a1' } },
        ],
        isError: false,
      },
    }
    const collapsed = render(card, props)
    assert.equal(textOf(collapsed).includes('图片已读取'), false, 'details must start collapsed')

    const toggle = findAll(collapsed, 'button').find((node) => textOf(node) === '详情')
    assert.equal(typeof toggle.props.onClick, 'function', 'the details toggle is not clickable')
    toggle.props.onClick()

    const opened = render(card, props)
    const panels = findAll(opened, 'pre').map(textOf)
    assert.equal(panels.length, 2)
    assert.match(panels[0], /"file_path": "hero\.png"/)
    assert.match(panels[1], /图片已读取/)
    assert.match(panels[1], /\[image\]/)
    assert.equal(panels[1].includes('attachmentId'), false, 'a live attachment reference must never be serialized')
  })

  it('keeps the details toggle on the degraded path', () => {
    const props = { callId: 'c12', toolName: 'read_image', block: { argsRaw: '{"file_path":"a/b"}' } }
    const collapsed = render(card, props)
    assert.equal(findAll(collapsed, 'img').length, 0)
    findAll(collapsed, 'button').find((node) => textOf(node) === '详情').props.onClick()
    assert.match(findAll(render(card, props), 'pre').map(textOf).join('\n'), /"file_path": "a\/b"/)
  })

  it('degrades instead of rendering a broken thumbnail for an extensionless path', () => {
    const tree = render(card, propsFor('.dsh/attachments/ab12cd'))
    assert.equal(findAll(tree, 'img').length, 0)
    assert.match(textOf(tree), /没有可识别的图片扩展名/)
  })

  it('degrades for a missing or unparsable argument', () => {
    for (const argsRaw of ['{}', 'not json', '']) {
      const tree = render(card, { callId: 'c6', toolName: 'read_image', block: { argsRaw } })
      assert.equal(findAll(tree, 'img').length, 0)
      assert.match(textOf(tree), /未提供 file_path/)
    }
  })

  it('reports a failed read while still offering the picture', () => {
    const tree = render(card, {
      callId: 'c7',
      toolName: 'read_image',
      cwd: 'D:\\work',
      block: {
        kind: 'tool-result',
        callId: 'c7',
        call: { name: 'read_image', argsRaw: '{"file_path":"gone.png"}' },
        isError: true,
      },
    })
    assert.match(textOf(tree), /读取失败/)
    assert.equal(textOf(findAll(tree, 'span').find((n) => n.props.className === 'diw-cardState')), '失败')
    assert.equal(findAll(tree, 'img').length, 1)
  })
})

describe('Drawer', () => {
  beforeEach(() => {
    resetHooks()
  })

  it('renders nothing until it is opened', () => {
    assert.equal(render(plugin.Drawer, {}), null)
  })
})

describe('SidebarToggle', () => {
  beforeEach(() => {
    resetHooks()
  })

  it('toggles without rendering the picture itself', () => {
    const tree = render(plugin.SidebarToggle, { wide: true })
    assert.equal(findAll(tree, 'img').length, 0)
    assert.equal(typeof findAll(tree, 'button')[0].props.onClick, 'function')
    assert.match(textOf(tree), /图片/)
  })

  it('drops its label in the collapsed rail', () => {
    const tree = render(plugin.SidebarToggle, { wide: false })
    assert.equal(textOf(tree).includes('图片'), false)
    assert.equal(findAll(tree, 'button')[0].props.className.includes('diw-btnIcon'), true)
  })
})
