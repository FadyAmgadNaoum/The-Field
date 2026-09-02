import { customType } from 'drizzle-orm/pg-core'

/**
 * PostgreSQL `inet` column type.
 *
 * Doc 05 uses `INET` for IP address columns on bookings, payment records,
 * payment proofs and admin users. Values are handled as strings in the
 * application; PostgreSQL validates and normalises them.
 */
export const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'inet'
  },
})
