// src/lib/infrastructure/inputValidator.test.ts
import { describe, it, expect } from 'vitest'
import { 
  validatePhone, 
  validateEmail, 
  validateString, 
  validatePlainText,
  validateInteger,
  validateISODate,
  validateUrl,
  validateFileType,
  escapeLikePattern
} from './inputValidator'

describe('Input Validator', () => {
  describe('validatePhone', () => {
    it('should normalize and return valid phone numbers', () => {
      expect(validatePhone('+91 98765-43210')).toBe('919876543210')
      expect(validatePhone('1234567890')).toBe('1234567890')
    })

    it('should throw for invalid phone lengths', () => {
      expect(() => validatePhone('123')).toThrow('Phone number must be 10-15 digits')
      expect(() => validatePhone('1234567890123456')).toThrow('Phone number must be 10-15 digits')
    })

    it('should throw if input is not a string', () => {
      expect(() => validatePhone(null)).toThrow('Phone number is required')
    })
  })

  describe('validateEmail', () => {
    it('should normalize and return valid emails', () => {
      expect(validateEmail(' USER@Example.Com ')).toBe('user@example.com')
    })

    it('should throw for invalid email formats', () => {
      expect(() => validateEmail('invalid-email')).toThrow('Invalid email address')
      expect(() => validateEmail('user@com')).toThrow('Invalid email address')
    })
  })

  describe('validateString', () => {
    it('should validate string length', () => {
      expect(validateString('hello', 3, 10)).toBe('hello')
      expect(() => validateString('hi', 3, 10)).toThrow('must be at least 3 characters')
      expect(() => validateString('too long', 3, 5)).toThrow('must not exceed 5 characters')
    })
  })

  describe('validatePlainText', () => {
    it('should strip dangerous HTML and scripts', () => {
      const dirty = 'Hello <script>alert(1)</script> <img onerror=alert(1)> World'
      const clean = validatePlainText(dirty)
      expect(clean).toBe('Hello World')
    })
  })

  describe('validateInteger', () => {
    it('should validate integers within range', () => {
      expect(validateInteger('42', 0, 100)).toBe(42)
      expect(() => validateInteger('42.5')).toThrow('must be an integer')
      expect(() => validateInteger('150', 0, 100)).toThrow('must be between 0 and 100')
    })
  })

  describe('validateISODate', () => {
    it('should validate ISO date strings', () => {
      const now = new Date().toISOString()
      expect(validateISODate(now)).toBe(now)
      expect(() => validateISODate('not-a-date')).toThrow('is not a valid date')
    })
  })

  describe('validateUrl', () => {
    it('should validate valid URLs', () => {
      expect(validateUrl('https://example.com')).toBe('https://example.com')
      expect(() => validateUrl('just-a-string')).toThrow('must be a valid URL')
    })
  })

  describe('validateFileType', () => {
    it('should allow valid file types', () => {
      const allowed = ['image/jpeg', 'application/pdf']
      expect(validateFileType('image/jpeg', allowed)).toBe('image/jpeg')
      expect(validateFileType('IMAGE/JPEG; charset=utf-8', allowed)).toBe('image/jpeg')
    })

    it('should throw for disallowed file types', () => {
      expect(() => validateFileType('text/html', ['image/jpeg'])).toThrow('File type not allowed')
    })
  })

  describe('escapeLikePattern', () => {
    it('should escape LIKE control characters', () => {
      expect(escapeLikePattern('100%_complete\\')).toBe('100\\%\\_complete\\\\')
    })
  })
})
