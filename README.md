<h1>Boardinpass Guide</h1>

Application for managing reservations, written in node,express using mariadb.

<h2>Project</h2>

Here is brief overview of project and how to run it, deploy and manage.

<h3>Installation</h3>

When you clone project run this command.<br>

```bash
npm install
```
And all dependencies will be installed.
<h3>Build</h3>
Project will build into javascript and will be saved under dist/out-tsc. <br>
This command specifies the correct path to the compiled app.js file within the dist/out-tsc directory.

```bash
tsc
node dist/out-tsc/app.js
```

NOTE: You dont need to run this commands, u can run project with command below.
<h3>Run</h3>
If you are using TypeScript and you want to run your application directly with ts-node (without compiling to JavaScript first), you can use:

```bash
npx ts-node src/app.ts
```

<h2>Database</h2>

Database is located under db/ folder, its relation database and its written in mariadb(open source mysql).<br>

<h3>Installation</h3>

To install database u will need to run these commands. (Expected that server is on Ubuntu)

```bash 
sudo apt update
sudo apt install mariadb-server
sudo mysql_secure_installation
```

Then u need to check if process(service) is running in background, if not run this command.

```bash
sudo systemctl start mariadb.service
```

<h3>Configuring database</h3>

For new MariaDB installations, the next step is to run the included security script. This script changes some of the less secure default options for things like remote root logins and sample users.

Run the security script:

```bash
sudo mysql_secure_installation
```

<h3>Importing database</h3>

This command is used to add your database

```bash
mariadb < path/to/folder/ddl.sql
```

<h2>Deployment</h2>

Currently, deployment is on dev stage and its done manually with help of tmux.



