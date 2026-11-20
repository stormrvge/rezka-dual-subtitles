const {test} = require('node:test');
const assert = require('node:assert/strict');
const net = require('../background.js');

test('subtitle URL validation blocks scripts, credentials and non-subtitle files', () => {
  assert.equal(net.validSubtitleUrl('https://static.voidboost.com/view/token/episode/en.vtt').hostname, 'static.voidboost.com');
  for (const value of ['javascript:alert(1)', 'https://a:b@cdn.example/sub.vtt', 'https://cdn.example/video.mp4', 'file:///tmp/en.vtt']) {
    assert.throws(() => net.validSubtitleUrl(value));
  }
});

test('bounded reader rejects media and oversized bodies', async () => {
  const text = 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello';
  assert.equal(await net.readSubtitleResponse(new Response(text)), text);
  await assert.rejects(net.readSubtitleResponse(new Response('movie', {headers:{'Content-Type':'video/mp4'}})));
  await assert.rejects(net.readSubtitleResponse(new Response(text, {headers:{'Content-Length':'6000000'}})));
  await assert.rejects(net.readSubtitleResponse(new Response('x'.repeat(5 * 1024 * 1024 + 1))));
});

test('HTTP errors are reported instead of interpreted as subtitle files', async () => {
  await assert.rejects(net.readSubtitleResponse(new Response('Forbidden', {status:403})), /403/);
});
