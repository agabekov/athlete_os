import { afterEach, describe, expect, it } from 'vitest'
import { isAllowedHost } from '../middleware'

describe('host allow-list middleware helper', () => {
  afterEach(() => {
    delete process.env.WHOOP_ALLOWED_HOSTS
  })

  it('allows loopback hosts by default', () => {
    expect(isAllowedHost('localhost:3000')).toBe(true)
    expect(isAllowedHost('127.0.0.1:3000')).toBe(true)
    expect(isAllowedHost('[::1]:3000')).toBe(true)
  })

  it('rejects public hosts unless configured', () => {
    expect(isAllowedHost('whoop.example.com')).toBe(false)
  })

  it('allows configured public hostnames with or without ports', () => {
    process.env.WHOOP_ALLOWED_HOSTS = 'whoop.example.com, https://dash.example.net'

    expect(isAllowedHost('whoop.example.com')).toBe(true)
    expect(isAllowedHost('whoop.example.com:3000')).toBe(true)
    expect(isAllowedHost('dash.example.net')).toBe(true)
    expect(isAllowedHost('other.example.net')).toBe(false)
  })
})
