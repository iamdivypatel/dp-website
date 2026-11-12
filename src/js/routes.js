// One address per section of the one-page site, so search engines and shared links see /about,
// /journey… with their own title and description. It's still a single page:
// - scripts/sections.mjs builds public/about.html etc.: copies of index.html with that route's <head>.
// - main.js scrolls to the section on load, glides there on click, and keeps the address bar in step.
// Every fact in a description must come from the CV.
export const routes = [
  {
    path: '/',
    id: 'top',
    title: 'Divya Patel – Backend & Cloud Engineer', // must match the <title> in index.html
  },
  {
    path: '/about',
    id: 'about',
    title: 'About – Divya Patel, Backend & Cloud Engineer',
    description: 'About Divya Patel: Backend & Cloud Engineer in Ahmedabad, India with 3+ years of production systems on AWS, from Terraform for a whole AWS account to the services on top.',
  },
  {
    path: '/how-i-build',
    id: 'stack',
    title: 'How I build – Divya Patel, Backend & Cloud Engineer',
    description: 'The production system Divya Patel designs and runs at Refy9, in 3D: AWS infrastructure with Terraform, serverless APIs on Lambda, caching with Redis, CI/CD and observability.',
  },
  {
    path: '/journey',
    id: 'journey',
    title: 'Journey – Divya Patel, Backend & Cloud Engineer',
    description: 'Divya Patel’s career: Backend & Cloud Engineer at Refy9 since Feb 2026, Full-Stack Developer at Blisslers Technolabs (2024–2026) and freelance developer (2023–2024).',
  },
  {
    path: '/projects',
    id: 'projects',
    title: 'Projects – Divya Patel, Backend & Cloud Engineer',
    description: 'Client projects Divya Patel built at Blisslers Technolabs: Golf Daddy, E4RTH, AdUP, GREEN_EV and a real-time fuel monitoring system.',
  },
  {
    path: '/industries',
    id: 'industries',
    title: 'Industries – Divya Patel, Backend & Cloud Engineer',
    description: 'The six industries Divya Patel has built production backends for, and the problems they share: roles, live data, queues, notifications, APIs and billing.',
  },
  {
    path: '/skills',
    id: 'skills',
    title: 'Skills – Divya Patel, Backend & Cloud Engineer',
    description: 'Divya Patel’s skills: system design, AWS (Lambda, API Gateway, Aurora, SQS, EventBridge), Terraform, Redis caching, GitHub Actions, Grafana, PostgreSQL, Node.js and TypeScript.',
  },
  {
    path: '/education',
    id: 'education',
    title: 'Education – Divya Patel, Backend & Cloud Engineer',
    description: 'Divya Patel’s education: Master of Science and Bachelor of Science in Information Technology from Ganpat University.',
  },
  {
    path: '/contact',
    id: 'contact',
    title: 'Contact – Divya Patel, Backend & Cloud Engineer',
    description: 'Contact Divya Patel, Backend & Cloud Engineer in Ahmedabad, India: email, phone, LinkedIn, a message form and the CV to download.',
  },
];
