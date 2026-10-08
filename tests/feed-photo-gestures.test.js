const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../mobile/node_modules/typescript');

function viewer() {
  let responder;
  const zoomChanges = [];
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } stopAnimation() {} }
  const animation = (value, options) => ({ start: () => value.setValue(options.toValue) });
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }), useMemo: fn => fn(), useEffect: fn => fn(),
  };
  const native = {
    View: 'View', StyleSheet: { absoluteFill: {} },
    PanResponder: { create: handlers => { responder = handlers; return { panHandlers: {} }; } },
    Animated: { Value, View: 'AnimatedView', spring: animation, parallel: animations => ({ start: () => animations.forEach(a => a.start()) }) },
  };
  const exports = {};
  const source = fs.readFileSync(require.resolve('../mobile/components/ZoomablePostImage.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === 'expo-image') return { Image: 'Image' };
    throw new Error(name);
  } });
  const tree = exports.ZoomablePostImage({ uri: 'fixture', width: 400, onZoomChange: zoom => zoomChanges.push(zoom) });
  const transform = tree.children[0].props.style[1].transform;
  return { responder, tree, zoomChanges, scale: transform[2].scale, x: transform[0].translateX };
}
const touch = x => ({ pageX: x, pageY: 100, locationX: x, locationY: 100 });
const event = (touches, x = 100) => ({ nativeEvent: { touches, pageX: x, pageY: 100 } });

test('post viewer captures a second finger, pinches, clamps zoom and locks album paging', () => {
  const v = viewer(), r = v.responder;
  assert.equal(r.onStartShouldSetPanResponder(), false, 'unzoomed swipe belongs to album');
  assert.equal(r.onStartShouldSetPanResponderCapture(event([touch(100), touch(200)])), true);
  r.onPanResponderGrant(event([touch(100), touch(200)]));
  r.onPanResponderMove(event([touch(100), touch(200)]), { dx: 0, dy: 0 });
  r.onPanResponderMove(event([touch(50), touch(250)]), { dx: 0, dy: 0 });
  assert.equal(v.scale.value, 2);
  assert.equal(v.zoomChanges.at(-1), true);
  r.onPanResponderMove(event([touch(-500), touch(1000)]), { dx: 0, dy: 0 });
  assert.equal(v.scale.value, 4);
  r.onPanResponderRelease();
  assert.equal(r.onStartShouldSetPanResponder(), true, 'zoomed image owns pan');
});

test('double tap toggles zoom and releases album paging when reset', () => {
  const v = viewer();
  const tap = () => { v.tree.props.onTouchStart(event([touch(100)])); v.tree.props.onTouchEnd(event([])); };
  tap(); tap();
  assert.equal(v.scale.value, 2.5);
  assert.equal(v.zoomChanges.at(-1), true);
  tap(); tap();
  assert.equal(v.scale.value, 1);
  assert.equal(v.x.value, 0);
  assert.equal(v.zoomChanges.at(-1), false);
});

test('pinching back to original size restores album paging without triggering double tap', () => {
  const v = viewer(), r = v.responder;
  r.onPanResponderGrant(event([touch(50), touch(250)]));
  r.onPanResponderMove(event([touch(50), touch(250)]), { dx: 0, dy: 0 });
  r.onPanResponderMove(event([touch(100), touch(200)]), { dx: 0, dy: 0 });
  r.onPanResponderRelease();
  v.tree.props.onTouchEnd(event([]));
  assert.equal(v.scale.value, 1);
  assert.equal(v.zoomChanges.at(-1), false);
});
