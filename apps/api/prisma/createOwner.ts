import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('Admin@123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@myewards.com' },
    update: {},
    create: {
      email: 'admin@myewards.com',
      password: hash,
      role: 'OWNER',
      isActive: true,
      profile: {
        create: {
          employeeId: 'OWNER001',
          firstName: 'Admin',
          lastName: 'Owner',
          designation: 'Owner',
          department: 'Management',
          officeLocation: 'HQ',
        },
      },
    },
  });
  console.log('Owner account created:', user.email);
}

main().catch(console.error).finally(() => prisma.$disconnect());
