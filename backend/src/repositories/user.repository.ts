import db, { UserEntity, PublicUserProfile } from "../db/database";
import crypto from "crypto";

export class UserRepository {
  /**
   * Find a user by public tag (optimized by UNIQUE index on tag).
   */
  static findByTag(tag: string): UserEntity | undefined {
    const cleanTag = tag.trim().toLowerCase().replace(/^@/, "");
    const stmt = db.prepare("SELECT * FROM users WHERE tag = ?");
    return stmt.get(cleanTag) as UserEntity | undefined;
  }

  /**
   * Find user by internal immutable UUID.
   */
  static findById(id: string): UserEntity | undefined {
    const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
    return stmt.get(id) as UserEntity | undefined;
  }

  /**
   * Retrieve primary account user (Tyler Durden).
   */
  static getPrimaryUser(): UserEntity {
    const stmt = db.prepare("SELECT * FROM users WHERE tag = 'tyler'");
    const user = stmt.get() as UserEntity | undefined;
    if (!user) {
      throw new Error("Primary user (Tyler Durden) not found in database.");
    }
    return user;
  }

  /**
   * Create a new user with cryptographically secure UUID generation.
   * Internal UUID is generated via crypto.randomUUID() and enforced by PRIMARY KEY constraint.
   */
  static create(data: {
    tag: string;
    display_name: string;
    email: string;
    birth_year: number;
    initial_balance_cents?: number;
  }): UserEntity {
    const uuid = crypto.randomUUID(); // Cryptographically secure UUID
    const cleanTag = data.tag.trim().toLowerCase().replace(/^@/, "");
    const now = new Date().toISOString();
    const balanceCents = Math.floor(data.initial_balance_cents || 0);

    const stmt = db.prepare(`
      INSERT INTO users (id, tag, display_name, email, birth_year, status, balance_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
    `);

    stmt.run(uuid, cleanTag, data.display_name, data.email, data.birth_year, balanceCents, now, now);

    return this.findById(uuid)!;
  }

  /**
   * Map UserEntity to PublicUserProfile, ensuring internal UUID is NEVER exposed.
   */
  static toPublicProfile(user: UserEntity): PublicUserProfile {
    return {
      tag: `@${user.tag}`,
      display_name: user.display_name,
      email: user.email,
      birth_year: user.birth_year,
      status: user.status,
      created_at: user.created_at,
    };
  }
}
